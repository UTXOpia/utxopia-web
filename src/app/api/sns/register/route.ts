import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  PublicKey,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  NATIVE_MINT,
  createAssociatedTokenAccountIdempotentInstruction,
  createCloseAccountInstruction,
  createSyncNativeInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import { sha256Hash } from "@utxopia/sdk";
import {
  Numberu32,
  Numberu64,
  createInstruction,
  createReverseInstruction,
  transferInstruction,
} from "@bonfida/spl-name-service";
import { getRelayerKeypair } from "@/lib/server/relayer";
import { checkRateLimit, getClientIp } from "@/lib/server/rate-limit";
import { resolveSolanaRouteConfig } from "@/lib/server/solana-route-context";
import type { NetworkConfig } from "@/lib/network-config";

export const dynamic = "force-dynamic";

const HASH_PREFIX = "SPL Name Service";
const SNS_DISC_REALLOC = 4;
const SNS_DISC_UPDATE = 1;
const SNS_HEADER_SIZE = 96;
const STEALTH_DATA_SIZE = 65;
const BONFIDA_FEE_OWNER = new PublicKey("5D2zKog251d6KPCyFyLMt3KroWwXXPWSgTPyhV22K2gR");
const WSOL_WRAP_AMOUNT = 10_000_000;

type PrepareRequest = {
  action: "prepare";
  name: string;
  owner: string;
  stealthData: string;
};

type SubmitRequest = {
  action: "submit";
  signedTransaction: string;
  lastValidBlockHeight?: number;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function parseHexBytes(value: string, expectedLength: number, field: string): Uint8Array {
  if (!/^[0-9a-fA-F]+$/.test(value) || value.length !== expectedLength * 2) {
    throw new Error(`${field} must be ${expectedLength} bytes of hex`);
  }
  return Uint8Array.from(Buffer.from(value, "hex"));
}

function normalizeSubdomain(name: string) {
  const subdomain = name.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(subdomain)) {
    throw new Error("Invalid subdomain name");
  }
  if (subdomain.includes(".")) {
    throw new Error("Subdomain must not include dots");
  }
  return subdomain;
}

async function buildSponsoredRegistrationTx(input: PrepareRequest, networkConfig: NetworkConfig) {
  const relayer = getRelayerKeypair();
  if (!relayer) {
    return { relayerUnavailable: true as const };
  }

  const owner = new PublicKey(input.owner);
  const subdomain = normalizeSubdomain(input.name);
  const stealthData = parseHexBytes(input.stealthData, STEALTH_DATA_SIZE, "stealthData");
  if (stealthData[0] !== 2) {
    throw new Error("Unsupported stealth data version");
  }

  const sns = networkConfig.sns;
  if (
    !sns?.subRegistrarProgramId ||
    !sns.nameServiceProgramId ||
    !sns.registrarProgramId ||
    !sns.rootDomain ||
    !sns.reverseLookupClass ||
    !sns.parentDomain
  ) {
    throw new Error("SNS not configured for this network");
  }

  const connection = new Connection(networkConfig.solana.rpcUrl, "confirmed");
  const nameServiceProgramId = new PublicKey(sns.nameServiceProgramId);
  const subRegistrarProgramId = new PublicKey(sns.subRegistrarProgramId);
  const snsRegistrarProgramId = new PublicKey(sns.registrarProgramId);
  const rootDomain = new PublicKey(sns.rootDomain);
  const reverseLookupClass = new PublicKey(sns.reverseLookupClass);
  const parentPubkey = deriveParentDomainKey(sns.parentDomain, rootDomain, nameServiceProgramId);
  const parentInfo = await connection.getAccountInfo(parentPubkey);
  if (!parentInfo) {
    throw new Error(
      `${sns.parentDomain}.sol parent domain is not initialized on this network`,
    );
  }

  const hashedSub = sha256Hash(new TextEncoder().encode(HASH_PREFIX + "\0" + subdomain));
  const [subdomainKey] = PublicKey.findProgramAddressSync(
    [hashedSub, new Uint8Array(32), parentPubkey.toBytes()],
    nameServiceProgramId,
  );
  if (await connection.getAccountInfo(subdomainKey)) {
    throw new Error(`"${subdomain}.${sns.parentDomain}.sol" is already registered`);
  }

  const reverseHash = sha256Hash(new TextEncoder().encode(HASH_PREFIX + subdomainKey.toBase58()));
  const [reverseKey] = PublicKey.findProgramAddressSync(
    [reverseHash, reverseLookupClass.toBytes(), parentPubkey.toBytes()],
    nameServiceProgramId,
  );
  const [registrar] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("registrar"), parentPubkey.toBytes()],
    subRegistrarProgramId,
  );
  const [subRecord] = PublicKey.findProgramAddressSync(
    [new TextEncoder().encode("subrecord"), subdomainKey.toBytes()],
    subRegistrarProgramId,
  );

  const registrarAcct = await connection.getAccountInfo(registrar);
  if (!registrarAcct) {
    if (!parentInfo.data.slice(32, 64).equals(relayer.publicKey.toBuffer())) {
      throw new Error("Sub-registrar not initialized and relayer does not own parent domain");
    }

    const rent = await connection.getMinimumBalanceForRentExemption(
      SNS_HEADER_SIZE + STEALTH_DATA_SIZE,
    );
    const createIx = createInstruction(
      nameServiceProgramId,
      SystemProgram.programId,
      subdomainKey,
      relayer.publicKey,
      relayer.publicKey,
      Buffer.from(hashedSub),
      new Numberu64(rent),
      new Numberu32(STEALTH_DATA_SIZE),
      undefined,
      parentPubkey,
      relayer.publicKey,
    );
    const createReverseIx = new createReverseInstruction({ name: "\0" + subdomain }).getInstruction(
      snsRegistrarProgramId,
      nameServiceProgramId,
      rootDomain,
      reverseKey,
      SystemProgram.programId,
      reverseLookupClass,
      relayer.publicKey,
      SYSVAR_RENT_PUBKEY,
      parentPubkey,
      relayer.publicKey,
    );
    const transferIx = transferInstruction(
      nameServiceProgramId,
      subdomainKey,
      owner,
      relayer.publicKey,
      undefined,
      parentPubkey,
      relayer.publicKey,
    );

    const updateData = new Uint8Array(1 + 4 + 4 + stealthData.length);
    updateData[0] = SNS_DISC_UPDATE;
    new DataView(updateData.buffer).setUint32(1, 0, true);
    new DataView(updateData.buffer).setUint32(5, stealthData.length, true);
    updateData.set(stealthData, 9);

    const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
    const tx = new Transaction({ feePayer: relayer.publicKey, blockhash, lastValidBlockHeight })
      .add(
        createIx,
        createReverseIx,
        transferIx,
        new TransactionInstruction({
          programId: nameServiceProgramId,
          keys: [
            { pubkey: subdomainKey, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: false },
          ],
          data: Buffer.from(updateData),
        }),
      );
    tx.partialSign(relayer);

    return {
      transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
      relayer: relayer.publicKey.toBase58(),
      lastValidBlockHeight,
      mode: "parent-owner-direct",
    };
  }
  const feeAccount = new PublicKey(registrarAcct.data.slice(34, 66));
  const mint = new PublicKey(registrarAcct.data.slice(66, 98));
  const feeSource = getAssociatedTokenAddressSync(mint, owner, true);
  const bonfidaFee = getAssociatedTokenAddressSync(mint, BONFIDA_FEE_OWNER, true);

  const ixs: TransactionInstruction[] = [
    createAssociatedTokenAccountIdempotentInstruction(
      relayer.publicKey,
      feeSource,
      owner,
      NATIVE_MINT,
    ),
    SystemProgram.transfer({
      fromPubkey: relayer.publicKey,
      toPubkey: feeSource,
      lamports: WSOL_WRAP_AMOUNT,
    }),
    createSyncNativeInstruction(feeSource),
    createAssociatedTokenAccountIdempotentInstruction(
      relayer.publicKey,
      bonfidaFee,
      BONFIDA_FEE_OWNER,
      mint,
    ),
  ];

  const domainBytes = new TextEncoder().encode("\0" + subdomain);
  const registerData = new Uint8Array(1 + 4 + domainBytes.length);
  registerData[0] = 2;
  new DataView(registerData.buffer).setUint32(1, domainBytes.length, true);
  registerData.set(domainBytes, 5);

  ixs.push(new TransactionInstruction({
    programId: subRegistrarProgramId,
    keys: [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: nameServiceProgramId, isSigner: false, isWritable: false },
      { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
      { pubkey: snsRegistrarProgramId, isSigner: false, isWritable: false },
      { pubkey: rootDomain, isSigner: false, isWritable: false },
      { pubkey: reverseLookupClass, isSigner: false, isWritable: false },
      { pubkey: feeAccount, isSigner: false, isWritable: true },
      { pubkey: feeSource, isSigner: false, isWritable: true },
      { pubkey: registrar, isSigner: false, isWritable: true },
      { pubkey: parentPubkey, isSigner: false, isWritable: true },
      { pubkey: subdomainKey, isSigner: false, isWritable: true },
      { pubkey: reverseKey, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: true },
      { pubkey: bonfidaFee, isSigner: false, isWritable: true },
      { pubkey: subRecord, isSigner: false, isWritable: true },
    ],
    data: Buffer.from(registerData),
  }));

  ixs.push(createCloseAccountInstruction(feeSource, relayer.publicKey, owner));

  const reallocData = new Uint8Array(5);
  reallocData[0] = SNS_DISC_REALLOC;
  new DataView(reallocData.buffer).setUint32(1, STEALTH_DATA_SIZE, true);
  ixs.push(new TransactionInstruction({
    programId: nameServiceProgramId,
    keys: [
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
      { pubkey: subdomainKey, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(reallocData),
  }));

  const updateData = new Uint8Array(1 + 4 + 4 + stealthData.length);
  updateData[0] = SNS_DISC_UPDATE;
  new DataView(updateData.buffer).setUint32(1, 0, true);
  new DataView(updateData.buffer).setUint32(5, stealthData.length, true);
  updateData.set(stealthData, 9);
  ixs.push(new TransactionInstruction({
    programId: nameServiceProgramId,
    keys: [
      { pubkey: subdomainKey, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from(updateData),
  }));

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: relayer.publicKey, blockhash, lastValidBlockHeight }).add(...ixs);
  tx.partialSign(relayer);

  return {
    transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    relayer: relayer.publicKey.toBase58(),
    lastValidBlockHeight,
  };
}

function deriveParentDomainKey(
  parentDomain: string,
  rootDomain: PublicKey,
  nameServiceProgramId: PublicKey,
): PublicKey {
  const hashedParent = sha256Hash(new TextEncoder().encode(HASH_PREFIX + parentDomain));
  return PublicKey.findProgramAddressSync(
    [hashedParent, new Uint8Array(32), rootDomain.toBytes()],
    nameServiceProgramId,
  )[0];
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rl = checkRateLimit(ip, "sns-register", { maxTokens: 5, windowMs: 60_000 });
  if (rl.limited) {
    return jsonError("Too many SNS registration requests", 429);
  }

  try {
    const routeContext = resolveSolanaRouteConfig(request, "/api/sns/register");
    if ("error" in routeContext) return jsonError(routeContext.error, routeContext.status);

    const body = await request.json() as PrepareRequest | SubmitRequest;
    if (body.action === "prepare") {
      const result = await buildSponsoredRegistrationTx(body, routeContext.config);
      if ("relayerUnavailable" in result) {
        return NextResponse.json({ success: false, relayerUnavailable: true }, { status: 503 });
      }
      return NextResponse.json({ success: true, ...result });
    }

    if (body.action === "submit") {
      const raw = Buffer.from(body.signedTransaction, "base64");
      if (raw.length > 32_000) return jsonError("Transaction too large", 400);
      const connection = new Connection(routeContext.config.solana.rpcUrl, "confirmed");
      const tx = Transaction.from(raw);
      const signature = await connection.sendRawTransaction(raw, {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      const confirmation = await connection.confirmTransaction(
        {
          signature,
          blockhash: tx.recentBlockhash ?? (await connection.getLatestBlockhash("confirmed")).blockhash,
          lastValidBlockHeight:
            typeof body.lastValidBlockHeight === "number"
              ? body.lastValidBlockHeight
              : (await connection.getLatestBlockhash("confirmed")).lastValidBlockHeight,
        },
        "confirmed",
      );
      if (confirmation.value.err) {
        return jsonError(`SNS registration failed on-chain: ${JSON.stringify(confirmation.value.err)}`, 400);
      }
      return NextResponse.json({ success: true, signature });
    }

    return jsonError("Invalid action", 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SNS registration failed";
    return jsonError(message, 400);
  }
}
