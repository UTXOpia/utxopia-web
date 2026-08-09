/**
 * GET /api/admin/applications — everything submitted through /apply.
 *
 * Same split as `admin/members`: `BACKEND_API_KEY` authenticates this origin
 * and stays on the server, the invite admin key is the operator's own and is
 * passed through from the request, so the page can ask for a key without this
 * file ever shipping one.
 *
 * @module api/admin/applications
 */

import { NextRequest, NextResponse } from "next/server";
import { getBackendApiKey } from "@/lib/server/backend-auth";
import { verifiedBackendUrl } from "@/lib/server/invite-issue";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const adminKey = request.headers.get("x-invite-admin-key")?.trim();
  if (!adminKey) {
    return NextResponse.json({ error: "admin key required" }, { status: 401 });
  }

  // Applications are written against whatever INVITE_NETWORK names, so they are
  // read back from there too. A network query param would just be a way to look
  // in a database nothing writes to.
  const backendUrl = verifiedBackendUrl();
  if (!backendUrl) {
    return NextResponse.json({ error: "no verified vault configured" }, { status: 400 });
  }

  const headers: Record<string, string> = { "x-invite-admin-key": adminKey };
  const apiKey = getBackendApiKey();
  if (apiKey) headers["X-API-Key"] = apiKey;

  try {
    const upstream = await fetch(`${backendUrl}/api/applications`, {
      headers,
      cache: "no-store",
    });
    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "backend unreachable" },
      { status: 502 },
    );
  }
}
