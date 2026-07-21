import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { sha256Hash } from "@utxopia/sdk";
import { deleteInstruction } from "@bonfida/spl-name-service";
import { getRelayerKeypair } from "@/lib/server/relayer";
import { checkRateLimit, getClientIp } from "@/lib/server/rate-limit";
import { resolveSolanaRouteConfig } from "@/lib/server/solana-route-context";
import type { NetworkConfig } from "@/lib/network-config";

export const dynamic = "force-dynamic";

const HASH_PREFIX = "SPL Name Service";

type PrepareRequest = {
  action: "prepare";
  name: string;
  owner: string;
};

type SubmitRequest = {
  action: "submit";
  signedTransaction: string;
  lastValidBlockHeight?: number;
};

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
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

async function buildSponsoredDeleteTx(input: PrepareRequest, networkConfig: NetworkConfig) {
  const relayer = getRelayerKeypair();
  if (!relayer) {
    return { relayerUnavailable: true as const };
  }

  const owner = new PublicKey(input.owner);
  const subdomain = normalizeSubdomain(input.name);

  const sns = networkConfig.sns;
  if (
    !sns?.nameServiceProgramId ||
    !sns.rootDomain ||
    !sns.parentDomain
  ) {
    throw new Error("SNS not configured for this network");
  }

  const connection = new Connection(networkConfig.solana.rpcUrl, "confirmed");
  const nameServiceProgramId = new PublicKey(sns.nameServiceProgramId);
  const rootDomain = new PublicKey(sns.rootDomain);
  const parentPubkey = deriveParentDomainKey(sns.parentDomain, rootDomain, nameServiceProgramId);

  // Derive the subdomain key EXACTLY as the register route does.
  const hashedSub = sha256Hash(new TextEncoder().encode(HASH_PREFIX + "\0" + subdomain));
  const [subdomainKey] = PublicKey.findProgramAddressSync(
    [hashedSub, new Uint8Array(32), parentPubkey.toBytes()],
    nameServiceProgramId,
  );

  const subdomainInfo = await connection.getAccountInfo(subdomainKey);
  if (!subdomainInfo) {
    throw new Error(`"${subdomain}.${sns.parentDomain}.sol" is not registered`);
  }

  // On-chain owner is stored in header bytes 32..64.
  const currentOwner = new PublicKey(subdomainInfo.data.slice(32, 64));
  if (!currentOwner.equals(owner)) {
    return {
      ownerMismatch: true as const,
      error: "You don't own this name from this wallet",
    };
  }

  // Refund goes to the relayer since the relayer paid the rent during the
  // sponsored registration.
  const deleteIx = deleteInstruction(
    nameServiceProgramId,
    subdomainKey,
    relayer.publicKey,
    owner,
  );

  // NOTE: we intentionally do NOT delete the reverse-lookup account here.
  // Leaving it orphaned is harmless (it only maps subdomainKey -> name) and
  // avoids an extra owner-signed instruction; register handles reuse cleanly.

  const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
  const tx = new Transaction({ feePayer: relayer.publicKey, blockhash, lastValidBlockHeight }).add(deleteIx);
  tx.partialSign(relayer);

  return {
    transaction: tx.serialize({ requireAllSignatures: false }).toString("base64"),
    relayer: relayer.publicKey.toBase58(),
    lastValidBlockHeight,
    requiresOwnerSignature: true,
  };
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rl = checkRateLimit(ip, "sns-delete", { maxTokens: 5, windowMs: 60_000 });
  if (rl.limited) {
    return jsonError("Too many SNS delete requests", 429);
  }

  try {
    const routeContext = resolveSolanaRouteConfig(request, "/api/sns/delete");
    if ("error" in routeContext) return jsonError(routeContext.error, routeContext.status);

    const body = await request.json() as PrepareRequest | SubmitRequest;
    if (body.action === "prepare") {
      const result = await buildSponsoredDeleteTx(body, routeContext.config);
      if ("relayerUnavailable" in result) {
        return NextResponse.json({ success: false, relayerUnavailable: true }, { status: 503 });
      }
      if ("ownerMismatch" in result) {
        return NextResponse.json({ success: false, ownerMismatch: true, error: result.error }, { status: 400 });
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
        return jsonError(`SNS delete failed on-chain: ${JSON.stringify(confirmation.value.err)}`, 400);
      }
      return NextResponse.json({ success: true, signature });
    }

    return jsonError("Invalid action", 400);
  } catch (err) {
    const message = err instanceof Error ? err.message : "SNS delete failed";
    return jsonError(message, 400);
  }
}
