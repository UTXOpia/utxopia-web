import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import { parseSnsStealthData } from "@utxopia/sdk";
import { deriveParentDomainKey } from "@/lib/names/sns";
import { checkRateLimit, getClientIp } from "@/lib/server/rate-limit";
import { resolveSolanaRouteConfig } from "@/lib/server/solana-route-context";

export const dynamic = "force-dynamic";

// getProgramAccounts is a heavy RPC call, so the count is cached per network.
// The number is used for a low-emphasis "names claimed" line, where minute-scale
// staleness is fine.
const CACHE_TTL_MS = 60_000;

type CacheEntry = { expiresAt: number; count: number };
const countCache = new Map<string, CacheEntry>();

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function GET(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rl = checkRateLimit(ip, "sns-stats", { maxTokens: 30, windowMs: 60_000 });
  if (rl.limited) return jsonError("Too many SNS stats requests", 429);

  try {
    const routeContext = resolveSolanaRouteConfig(request, "/api/sns/stats");
    if ("error" in routeContext) return jsonError(routeContext.error, routeContext.status);
    const sns = routeContext.config.sns;
    if (!sns) return jsonError("SNS not configured for this network", 400);

    const url = new URL(request.url);
    const network = url.searchParams.get("network") ?? "default";
    const refresh = url.searchParams.get("refresh") === "1";

    const now = Date.now();
    const cached = countCache.get(network);
    if (!refresh && cached && cached.expiresAt > now) {
      return NextResponse.json({ success: true, count: cached.count, cached: true });
    }

    // All subdomain accounts parent-scoped to utxopia.sol (memcmp offset 0 =
    // parent domain). We don't add the per-owner filter (offset 32) that
    // sns/owner uses, so this returns every registered name. parseSnsStealthData
    // then discards anything that isn't a valid stealth-name record (e.g. reverse
    // lookups), so the total reflects real registrations only.
    const connection = new Connection(routeContext.config.solana.rpcUrl, "confirmed");
    const parentPubkey = deriveParentDomainKey(sns);
    const accounts = await connection.getProgramAccounts(new PublicKey(sns.nameServiceProgramId), {
      filters: [{ memcmp: { offset: 0, bytes: parentPubkey.toBase58() } }],
    });

    let count = 0;
    for (const account of accounts) {
      if (parseSnsStealthData(new Uint8Array(account.account.data))) count++;
    }

    countCache.set(network, { expiresAt: now + CACHE_TTL_MS, count });
    return NextResponse.json({ success: true, count, cached: false });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to count SNS registrations";
    return jsonError(message, 400);
  }
}
