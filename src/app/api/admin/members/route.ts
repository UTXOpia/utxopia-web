/**
 * GET /api/admin/members — the Verified cohort, for the operator.
 *
 * Two different secrets meet here, and only one of them may reach a browser:
 * `BACKEND_API_KEY` authenticates this origin to the backend and stays on the
 * server; the invite admin key is the operator's own and is passed through from
 * the request. So the page can ask for a key without this file ever shipping one.
 *
 * @module api/admin/members
 */

import { NextRequest, NextResponse } from "next/server";
import { getNetworkConfig, detectNetworkFromRequest, type NetworkId } from "@/lib/network-config";
import { getVaultNetworkConfig } from "@/lib/vault-config";
import { networkForChain } from "@/lib/chain-registry";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const adminKey = request.headers.get("x-invite-admin-key")?.trim();
  if (!adminKey) {
    return NextResponse.json({ error: "admin key required" }, { status: 401 });
  }

  const requested = request.nextUrl.searchParams.get("network") as NetworkId | null
    ?? detectNetworkFromRequest(request);
  const network = networkForChain(requested, "solana");

  let backendUrl: string;
  try {
    // Membership only exists in the Verified vault, so this is not a parameter.
    backendUrl = getVaultNetworkConfig(network, getNetworkConfig(network), "verified").backend.url;
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "unsupported network" },
      { status: 400 },
    );
  }

  const headers: Record<string, string> = { "x-invite-admin-key": adminKey };
  if (process.env.BACKEND_API_KEY) headers["X-API-Key"] = process.env.BACKEND_API_KEY;

  try {
    const upstream = await fetch(`${backendUrl.replace(/\/+$/, "")}/api/invite/members`, {
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
