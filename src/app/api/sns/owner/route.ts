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

const POSITIVE_TTL_MS = 30_000;
const NEGATIVE_TTL_MS = 10_000;

type OwnerRecord = {
  name: string | null;
  fullDomain: string | null;
  subdomainKey: string;
  version: number;
  viewingPubKey: string;
  mpk: string;
  complianceFlags: number;
  auditorPubkey: string | null;
};

type CacheEntry = {
  expiresAt: number;
  body: {
    success: true;
    registered: boolean;
    records: OwnerRecord[];
  };
};

const ownerLookupCache = new Map<string, CacheEntry>();

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

function bytesToHex(bytes: Uint8Array) {
  return Buffer.from(bytes).toString("hex");
}

async function fetchOwnedSnsRecords(
  owner: PublicKey,
  connection: Connection,
  sns: SnsNetworkConfig,
): Promise<OwnerRecord[]> {
  const parentPubkey = deriveParentDomainKey(sns);
  const nameServiceProgramId = new PublicKey(sns.nameServiceProgramId);
  const accounts = await connection.getProgramAccounts(nameServiceProgramId, {
    filters: [
      { memcmp: { offset: 0, bytes: parentPubkey.toBase58() } },
      { memcmp: { offset: 32, bytes: owner.toBase58() } },
    ],
  });

  const records: OwnerRecord[] = [];
  for (const account of accounts) {
    const parsed = parseSnsStealthData(new Uint8Array(account.account.data));
    if (!parsed) continue;

    const reverseKey = deriveReverseLookupKey(account.pubkey, parentPubkey, sns);
    const reverseAcct = await connection.getAccountInfo(reverseKey);
    const name = reverseAcct ? parseSnsReverseName(reverseAcct.data) : null;
    const fullDomain = name ? `${name}.${sns.parentDomain}.sol` : null;
    const auditorPubkey = parsed.auditorPubkey
      ? new PublicKey(parsed.auditorPubkey).toBase58()
      : null;

    records.push({
      name,
      fullDomain,
      subdomainKey: account.pubkey.toBase58(),
      version: parsed.version,
      viewingPubKey: bytesToHex(parsed.viewingPubKey),
      mpk: bytesToHex(parsed.mpk),
      complianceFlags: parsed.complianceFlags ?? 0,
      auditorPubkey,
    });
  }

  return records;
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rl = checkRateLimit(ip, "sns-owner", { maxTokens: 30, windowMs: 60_000 });
  if (rl.limited) return jsonError("Too many SNS owner lookup requests", 429);

  try {
    const routeContext = resolveSolanaRouteConfig(request, "/api/sns/owner");
    if ("error" in routeContext) return jsonError(routeContext.error, routeContext.status);
    const sns = routeContext.config.sns;
    if (!sns) return jsonError("SNS not configured for this network", 400);

    const url = new URL(request.url);
    const ownerParam = url.searchParams.get("owner");
    if (!ownerParam) return jsonError("owner is required", 400);
    const owner = new PublicKey(ownerParam);
    const refresh = url.searchParams.get("refresh") === "1";
    const network = url.searchParams.get("network") ?? "default";
    const cacheKey = `${network}:${owner.toBase58()}`;

    const now = Date.now();
    const cached = ownerLookupCache.get(cacheKey);
    if (!refresh && cached && cached.expiresAt > now) {
      return NextResponse.json({ ...cached.body, cached: true });
    }

    const connection = new Connection(routeContext.config.solana.rpcUrl, "confirmed");
    const records = await fetchOwnedSnsRecords(owner, connection, sns);
    const body = {
      success: true as const,
      registered: records.length > 0,
      records,
    };
    ownerLookupCache.set(cacheKey, {
      expiresAt: now + (records.length > 0 ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
      body,
    });

    return NextResponse.json({ ...body, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to lookup SNS owner records";
    return jsonError(message, 400);
  }
}
