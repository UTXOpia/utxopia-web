import { NextRequest, NextResponse } from "next/server";
import { networkForChain } from "@/lib/chain-registry";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  type NetworkId,
} from "@/lib/network-config";
import { getVaultNetworkConfig } from "@/lib/vault-config";
import { applyBackendAuthHeaders } from "@/lib/server/backend-auth";

export const dynamic = "force-dynamic";

/**
 * Proxy for the Verified vault's invite endpoints.
 *
 * Only `challenge` and `redeem` are reachable. Minting codes is deliberately
 * absent: it is gated by a separate operator key on the backend and has no
 * business behind a public origin.
 */
const ALLOWED = new Set(["challenge", "redeem"]);

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> },
) {
  const { action } = await params;
  if (!ALLOWED.has(action)) {
    return NextResponse.json({ error: "unknown invite action" }, { status: 404 });
  }

  const requestedNetwork = request.nextUrl.searchParams.get("network") as NetworkId | null
    ?? detectNetworkFromRequest(request);
  const networkId = networkForChain(requestedNetwork, "solana");
  const config = getVaultNetworkConfig(
    networkId,
    getNetworkConfig(networkId),
    "verified",
  );

  const response = await fetch(
    `${config.backend.url.replace(/\/+$/, "")}/api/invite/${action}`,
    {
      method: "POST",
      headers: applyBackendAuthHeaders({ "Content-Type": "application/json" }),
      body: await request.text(),
      cache: "no-store",
    },
  );
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return NextResponse.json(body, { status: response.status });
}
