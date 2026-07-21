import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { parseSnsStealthData } from "@utxopia/sdk";
import {
  deriveParentDomainKey,
  deriveReverseLookupKey,
  parseSnsReverseName,
  type SnsNetworkConfig,
} from "@/lib/names/sns";
import { checkRateLimit, getClientIp } from "@/lib/server/rate-limit";
import { resolveSolanaRouteConfig } from "@/lib/server/solana-route-context";

export const dynamic = "force-dynamic";

// Resolve "my name" by the caller's stealth VIEWING KEY rather than by the
// on-chain owner. The viewing key is derived from the user's passkey/seed and is
// stable no matter which Solana wallet is connected, so name resolution no longer
// breaks when the active authority differs from the wallet recorded as owner at
// registration. See sns/owner (owner-scoped) for the legacy lookup.

const RECORDS_TTL_MS = 60_000;

type ParentRecord = {
  subdomainKey: string;
  viewingPubKey: string; // hex
  mpk: string; // hex
  version: number;
  complianceFlags: number;
  auditorPubkey: string | null;
};

const recordsCache = new Map<string, { expiresAt: number; records: ParentRecord[] }>();

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function bytesToHex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("hex");
}

/** All valid stealth-name records under the parent domain, without the (heavy)
 *  per-record reverse-name lookup — that's deferred to the single matched record. */
async function fetchParentRecords(
  connection: Connection,
  sns: SnsNetworkConfig,
): Promise<ParentRecord[]> {
  const parentPubkey = deriveParentDomainKey(sns);
  const accounts = await connection.getProgramAccounts(new PublicKey(sns.nameServiceProgramId), {
    filters: [{ memcmp: { offset: 0, bytes: parentPubkey.toBase58() } }],
  });

  const records: ParentRecord[] = [];
  for (const account of accounts) {
    const parsed = parseSnsStealthData(new Uint8Array(account.account.data));
    if (!parsed) continue;
    records.push({
      subdomainKey: account.pubkey.toBase58(),
      viewingPubKey: bytesToHex(parsed.viewingPubKey),
      mpk: bytesToHex(parsed.mpk),
      version: parsed.version,
      complianceFlags: parsed.complianceFlags ?? 0,
      auditorPubkey: parsed.auditorPubkey
        ? new PublicKey(parsed.auditorPubkey).toBase58()
        : null,
    });
  }
  return records;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rl = checkRateLimit(ip, "sns-resolve", { maxTokens: 30, windowMs: 60_000 });
  if (rl.limited) return jsonError("Too many SNS resolve requests", 429);

  try {
    const routeContext = resolveSolanaRouteConfig(request, "/api/sns/resolve");
    if ("error" in routeContext) return jsonError(routeContext.error, routeContext.status);
    const sns = routeContext.config.sns;
    if (!sns) return jsonError("SNS not configured for this network", 400);

    const url = new URL(request.url);
    const vk = url.searchParams.get("vk");
    if (!vk || !/^[0-9a-fA-F]{64}$/.test(vk)) {
      return jsonError("vk (64-hex viewing pubkey) is required", 400);
    }
    const vkNorm = vk.toLowerCase();
    const network = url.searchParams.get("network") ?? "default";
    const refresh = url.searchParams.get("refresh") === "1";

    const now = Date.now();
    let cached = recordsCache.get(network);
    if (refresh || !cached || cached.expiresAt <= now) {
      const connection = new Connection(routeContext.config.solana.rpcUrl, "confirmed");
      const records = await fetchParentRecords(connection, sns);
      cached = { expiresAt: now + RECORDS_TTL_MS, records };
      recordsCache.set(network, cached);
    }

    const match = cached.records.find((r) => r.viewingPubKey === vkNorm);
    if (!match) {
      return NextResponse.json({ success: true, registered: false });
    }

    // Reverse-resolve the human-readable name for the one matched record only.
    const connection = new Connection(routeContext.config.solana.rpcUrl, "confirmed");
    const parentPubkey = deriveParentDomainKey(sns);
    const reverseKey = deriveReverseLookupKey(new PublicKey(match.subdomainKey), parentPubkey, sns);
    const reverseAcct = await connection.getAccountInfo(reverseKey);
    const name = reverseAcct ? parseSnsReverseName(reverseAcct.data) : null;

    return NextResponse.json({
      success: true,
      registered: true,
      record: {
        name,
        fullDomain: name ? `${name}.${sns.parentDomain}.sol` : null,
        subdomainKey: match.subdomainKey,
        version: match.version,
        mpk: match.mpk,
        complianceFlags: match.complianceFlags,
        auditorPubkey: match.auditorPubkey,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to resolve SNS name";
    return jsonError(message, 400);
  }
}
