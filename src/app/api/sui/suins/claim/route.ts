import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { NextRequest, NextResponse } from "next/server";
import { ALLOWED_METADATA, SuinsClient, SuinsTransaction } from "@mysten/suins";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { checkRateLimit, getClientIp } from "@/lib/server/rate-limit";
import { getSuiRelayerKeypair } from "@/lib/server/sui-relayer";
import type { NetworkId } from "@/lib/network-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const UTXOPIA_SUINS_PARENT = "utxopia.sui";
const UTXOPIA_CONTENT_HASH_PREFIX = "utxopia:v1";
const LABEL_RE = /^[a-z0-9]{1,63}$/;
const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;
const HEX_32_RE = /^[0-9a-fA-F]{64}$/;
const DEFAULT_GAS_BUDGET = 100_000_000n;
const DEFAULT_SUBNAME_DAYS = 365;
const CHILD_EXPIRY_BUFFER_MS = 60_000;

type ClaimRequest = {
  handle?: string;
  name?: string;
  suiAddress?: string;
  loginId?: string;
  network?: NetworkId;
  viewingPubKey?: string;
  mpk?: string;
};

type ClaimRecord = {
  loginId: string;
  suiAddress: string;
  normalizedName: string;
  network: string;
  nftId: string | null;
  createDigest: string;
  claimedAt: string;
};

type ClaimLedger = {
  version: 1;
  claims: ClaimRecord[];
};

function jsonError(message: string, status: number, extra?: Record<string, unknown>) {
  return NextResponse.json({ success: false, error: message, ...extra }, { status });
}

function getLedgerPath() {
  // Default to a writable dir (Vercel's FS is read-only except os.tmpdir()).
  // The ledger is a best-effort double-claim hint; the authoritative guard is the
  // on-chain SuiNS name-record check in mintSubName().
  return process.env.UTXOPIA_SUINS_CLAIMS_PATH || path.join(os.tmpdir(), "sui-suins-claims.json");
}

function readLedger(): ClaimLedger {
  try {
    const file = getLedgerPath();
    if (!existsSync(file)) return { version: 1, claims: [] };
    return JSON.parse(readFileSync(file, "utf8")) as ClaimLedger;
  } catch {
    return { version: 1, claims: [] };
  }
}

function writeLedger(ledger: ClaimLedger) {
  try {
    const file = getLedgerPath();
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(ledger, null, 2));
  } catch {
    // Best-effort only — serverless FS may be ephemeral/read-only. The on-chain
    // SuiNS name-record check is the authoritative duplicate guard.
  }
}

function suinsNetworkFromAppNetwork(network: string | undefined) {
  return network === "mainnet" ? "mainnet" : "testnet";
}

function encodeContentHash(input: { network?: string; viewingPubKey: string; mpk: string }) {
  return [
    UTXOPIA_CONTENT_HASH_PREFIX,
    input.network ?? "sui-testnet",
    input.viewingPubKey.toLowerCase(),
    input.mpk.toLowerCase(),
  ].join(":");
}

function isMissingSuiNsRecordError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("does not exist") || message.includes("not found");
}

function normalizeName(input: string) {
  const trimmed = input.trim().toLowerCase();
  const label = trimmed.startsWith("@")
    ? trimmed.slice(1)
    : trimmed.endsWith(`.${UTXOPIA_SUINS_PARENT}`)
      ? trimmed.slice(0, -1 * (`.${UTXOPIA_SUINS_PARENT}`).length)
      : trimmed;
  if (!LABEL_RE.test(label)) {
    throw new Error("Choose a lowercase handle with letters and numbers only.");
  }
  return `${label}.${UTXOPIA_SUINS_PARENT}`;
}

// Sponsored SuiNS subname mint — runs INLINE (no child process) so it works on
// serverless (Vercel). Signs with the relayer keypair (UTXOPIA_SUI_RELAYER_PRIVATE_KEY),
// which holds the utxopia.sui parent NFT. Ported from scripts/sui-suins-claim.ts.
async function claimName(
  input: Required<Pick<ClaimRequest, "suiAddress" | "viewingPubKey" | "mpk">> & ClaimRequest,
): Promise<{ normalizedName: string; nftId: string | null; createDigest: string }> {
  const normalizedName = normalizeName(input.handle ?? input.name ?? "");
  if (!ADDRESS_RE.test(input.suiAddress)) throw new Error("Invalid Sui address.");
  if (!HEX_32_RE.test(input.viewingPubKey)) throw new Error("viewingPubKey must be 32 bytes of hex.");
  if (!HEX_32_RE.test(input.mpk)) throw new Error("mpk must be 32 bytes of hex.");

  const parentNftId =
    process.env.UTXOPIA_SUINS_PARENT_NFT_ID || process.env.NEXT_PUBLIC_UTXOPIA_SUINS_PARENT_NFT_ID;
  if (!parentNftId) throw new Error("UTXOPIA_SUINS_PARENT_NFT_ID is required for sponsored SuiNS claims.");

  const network = suinsNetworkFromAppNetwork(input.network);
  const rpcUrl =
    process.env.UTXOPIA_SUI_RPC_URL ||
    process.env.NEXT_PUBLIC_SUI_RPC_URL ||
    "https://fullnode.testnet.sui.io:443";
  const client = new SuiJsonRpcClient({ url: rpcUrl, network });
  const suinsClient = new SuinsClient({ client, network });

  const existing = await suinsClient.getNameRecord(normalizedName).catch((error) => {
    if (isMissingSuiNsRecordError(error)) return null;
    throw error;
  });
  if (existing) throw new Error(`${normalizedName} is already claimed.`);

  const parentRecord = await suinsClient.getNameRecord(UTXOPIA_SUINS_PARENT);
  if (!parentRecord?.expirationTimestampMs) {
    throw new Error(`${UTXOPIA_SUINS_PARENT} parent expiration was not discoverable.`);
  }
  const desiredExpirationMs = Date.now() + DEFAULT_SUBNAME_DAYS * 24 * 60 * 60 * 1000;
  const expirationTimestampMs = Math.min(
    desiredExpirationMs,
    Number(parentRecord.expirationTimestampMs) - CHILD_EXPIRY_BUFFER_MS,
  );
  if (expirationTimestampMs <= Date.now()) {
    throw new Error(`${UTXOPIA_SUINS_PARENT} is expired or too close to expiry.`);
  }

  const signer = getSuiRelayerKeypair();
  const tx = new Transaction();
  const suinsTx = new SuinsTransaction(suinsClient, tx);
  const subNft = suinsTx.createSubName({
    parentNft: parentNftId,
    name: normalizedName,
    expirationTimestampMs,
    allowChildCreation: false,
    allowTimeExtension: false,
  });
  suinsTx.setTargetAddress({ nft: subNft, address: input.suiAddress, isSubname: true });
  suinsTx.setUserData({
    nft: subNft,
    key: ALLOWED_METADATA.contentHash,
    value: encodeContentHash(input),
    isSubname: true,
  });
  tx.transferObjects([subNft], signer.toSuiAddress());
  tx.setSender(signer.toSuiAddress());
  tx.setGasBudget(BigInt(process.env.UTXOPIA_SUINS_GAS_BUDGET ?? DEFAULT_GAS_BUDGET.toString()));

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: { showEffects: true, showObjectChanges: true },
  });
  await client.waitForTransaction({ digest: result.digest, options: { showEffects: true } });
  if (result.effects?.status?.status === "failure") {
    throw new Error(result.effects.status.error || "SuiNS claim transaction failed");
  }
  const record = await suinsClient.getNameRecord(normalizedName).catch(() => null);
  return { normalizedName, nftId: record?.nftId ?? null, createDigest: result.digest };
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rl = checkRateLimit(ip, "sui-suins-claim", { maxTokens: 3, windowMs: 60_000 });
  if (rl.limited) {
    return jsonError("Too many SuiNS claim requests. Try again shortly.", 429, {
      retryAfterMs: rl.retryAfterMs,
    });
  }

  let body: ClaimRequest;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  if (!body.suiAddress || !body.viewingPubKey || !body.mpk) {
    return jsonError("suiAddress, viewingPubKey, and mpk are required.", 400);
  }

  let normalizedName: string;
  try {
    normalizedName = normalizeName(body.handle ?? body.name ?? "");
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Invalid SuiNS name.", 400);
  }

  const loginId = (body.loginId || body.suiAddress).trim().toLowerCase();
  const ledger = readLedger();
  const existingByLogin = ledger.claims.find((claim) => claim.loginId === loginId);
  if (existingByLogin) {
    return jsonError("This login already claimed a free SuiNS name.", 409, { claim: existingByLogin });
  }
  const existingByAddress = ledger.claims.find((claim) => claim.suiAddress.toLowerCase() === body.suiAddress!.toLowerCase());
  if (existingByAddress) {
    return jsonError("This Sui address already claimed a free SuiNS name.", 409, { claim: existingByAddress });
  }
  const existingByName = ledger.claims.find((claim) => claim.normalizedName === normalizedName);
  if (existingByName) {
    return jsonError("This SuiNS name has already been claimed.", 409, { claim: existingByName });
  }
  if (!process.env.UTXOPIA_SUINS_PARENT_NFT_ID && !process.env.NEXT_PUBLIC_UTXOPIA_SUINS_PARENT_NFT_ID) {
    return jsonError("UTXOPIA_SUINS_PARENT_NFT_ID is required for sponsored SuiNS claims.", 503);
  }

  try {
    const claimed = await claimName(body as Required<Pick<ClaimRequest, "suiAddress" | "viewingPubKey" | "mpk">> & ClaimRequest);
    const claim: ClaimRecord = {
      loginId,
      suiAddress: body.suiAddress,
      normalizedName: claimed.normalizedName,
      network: body.network ?? "sui-testnet",
      nftId: claimed.nftId,
      createDigest: claimed.createDigest,
      claimedAt: new Date().toISOString(),
    };
    ledger.claims.push(claim);
    writeLedger(ledger);

    return NextResponse.json({ success: true, claim });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not claim SuiNS name.";
    const status = /already claimed|already registered|already exists/i.test(message) ? 409 : 500;
    return jsonError(message, status);
  }
}
