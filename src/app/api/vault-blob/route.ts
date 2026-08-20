/**
 * /api/vault-blob — the login wrapping, proxied to the backend that stores it.
 *
 * This route holds the API key so the browser does not, and otherwise gets out
 * of the way: it never sees a PIN, never sees a signature, and cannot open what
 * it is passing along. Read `lib/vault-remote.ts` for what the two fields are
 * and why the id must never equal the signature's digest.
 *
 * The lockout that makes six digits mean anything lives in the backend, keyed
 * to the row rather than to an IP — an attacker rotates addresses, and the
 * member behind a shared NAT must not inherit somebody else's failures. What
 * the limiter here does is cheaper and different: it stops one host turning
 * random ids into unbounded database round trips.
 */

import { NextResponse } from "next/server";
import { applyBackendAuthHeaders, getBackendApiKey } from "@/lib/server/backend-auth";
import { verifiedBackendUrl } from "@/lib/server/invite-issue";
import { checkRateLimit, getClientIp } from "@/lib/server/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const HEX_64 = /^[0-9a-f]{64}$/;
const MAX_ENVELOPE = 1024;

async function forward(request: Request, path: string, body: unknown) {
  const limited = checkRateLimit(getClientIp(request.headers), "vault-blob", {
    maxTokens: 30,
    windowMs: 60_000,
  });
  if (limited.limited) {
    return NextResponse.json({ error: "Too many attempts. Wait a moment." }, { status: 429 });
  }

  const backendUrl = verifiedBackendUrl();
  if (!backendUrl || !getBackendApiKey()) {
    // Fails closed and says so. A member whose vault could not be published
    // still has their recovery string; one who thinks it was published and was
    // not has a backup that does not exist.
    return NextResponse.json({ error: "Vault backup is not configured." }, { status: 503 });
  }

  try {
    const response = await fetch(`${backendUrl}${path}`, {
      method: "POST",
      headers: applyBackendAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify(body),
      cache: "no-store",
    });
    if (response.status === 204) return new NextResponse(null, { status: 204 });
    const text = await response.text();
    return new NextResponse(text || "{}", {
      status: response.status,
      headers: { "Content-Type": "application/json" },
    });
  } catch (caught) {
    console.warn("[vault-blob] backend unreachable", caught);
    return NextResponse.json({ error: "Vault backup is unavailable." }, { status: 502 });
  }
}

interface Payload {
  id?: unknown;
  proof?: unknown;
  envelope?: unknown;
}

function credentials(body: Payload): { id: string; proof: string } | null {
  const id = typeof body.id === "string" ? body.id : "";
  const proof = typeof body.proof === "string" ? body.proof : "";
  return HEX_64.test(id) && HEX_64.test(proof) ? { id, proof } : null;
}

/** Publish, or replace a copy the member can already prove is theirs. */
export async function PUT(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Payload;
  const creds = credentials(body);
  const envelope = typeof body.envelope === "string" ? body.envelope : "";
  if (!creds || !envelope || envelope.length > MAX_ENVELOPE || !/^[0-9a-f]+$/.test(envelope)) {
    return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  }
  return forward(request, "/api/vault-blob", { ...creds, envelope });
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Payload;
  const creds = credentials(body);
  if (!creds) return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  return forward(request, "/api/vault-blob/get", creds);
}

/** The member dropping our copy. Same proof, same lockout — see the backend. */
export async function DELETE(request: Request) {
  const body = (await request.json().catch(() => ({}))) as Payload;
  const creds = credentials(body);
  if (!creds) return NextResponse.json({ error: "Malformed request." }, { status: 400 });
  return forward(request, "/api/vault-blob/delete", creds);
}
