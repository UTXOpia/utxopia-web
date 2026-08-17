/**
 * Solana JSON-RPC proxy for the browser.
 *
 * The keyed RPC URL cannot go in `NEXT_PUBLIC_SOLANA_RPC_URL` — that value is
 * inlined into the client bundle, so the token would be trivially extractable
 * from any deployed page. The tokenless form of the same endpoint answers
 * `403 Access forbidden`, which reaches the UI as "name not found" and similar
 * nonsense. So the browser talks to this route instead: same origin (already
 * covered by `connect-src 'self'`), and the token stays server-side.
 *
 * This is a proxy, not an open relay. Reads plus the few write methods a wallet
 * needs are allowed; anything else is rejected by name.
 *
 * @module api/rpc
 */

import { NextRequest, NextResponse } from "next/server";
import { getSolanaRpcUrl } from "@/lib/api/constants";
import { checkRateLimit, getClientIp, tooManyRequests } from "@/lib/server/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A single page load makes many reads, so this is generous by design. */
const RATE_LIMIT = { maxTokens: 300, windowMs: 60_000 };

/** Anything larger than this is not a JSON-RPC call we serve. */
const MAX_BODY_BYTES = 256 * 1024;

/**
 * Non-`get*` methods the app legitimately needs. Everything starting with
 * `get` is allowed as a read; subscriptions can't work over HTTP anyway, and
 * validator-admin methods have no business being reachable from a browser.
 */
const ALLOWED_WRITE_METHODS = new Set([
  "sendTransaction",
  "simulateTransaction",
  "isBlockhashValid",
  "requestAirdrop",
]);

function isAllowedMethod(method: unknown): boolean {
  if (typeof method !== "string") return false;
  return method.startsWith("get") || ALLOWED_WRITE_METHODS.has(method);
}

function badRequest(error: string) {
  return NextResponse.json({ error }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(getClientIp(request.headers), "rpc", RATE_LIMIT);
  const limited = tooManyRequests(rl);
  if (limited) return limited;

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) return badRequest("Request body too large");

  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return badRequest("Body is not valid JSON");
  }

  // web3.js batches some reads, so a payload can be a single call or an array.
  const calls = Array.isArray(payload) ? payload : [payload];
  if (calls.length === 0) return badRequest("Empty JSON-RPC batch");
  for (const call of calls) {
    const method = (call as { method?: unknown } | null)?.method;
    if (!isAllowedMethod(method)) {
      return badRequest(
        `Method not allowed through this proxy: ${typeof method === "string" ? method : "(missing)"}`,
      );
    }
  }

  try {
    const upstream = await fetch(getSolanaRpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: raw,
      // Don't let a hung upstream hold the function open to its duration cap.
      signal: AbortSignal.timeout(30_000),
    });
    // Pass the body through untouched — callers are JSON-RPC clients that
    // handle upstream error objects themselves.
    return new NextResponse(await upstream.text(), {
      status: upstream.status,
      headers: { "content-type": "application/json" },
    });
  } catch (err) {
    // Never surface the upstream URL: it carries the token.
    const reason = err instanceof Error && err.name === "TimeoutError"
      ? "Upstream RPC timed out"
      : "Upstream RPC request failed";
    return NextResponse.json({ error: reason }, { status: 502 });
  }
}
