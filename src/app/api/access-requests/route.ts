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

export async function POST(request: NextRequest) {
  const requestedNetwork = request.nextUrl.searchParams.get("network") as NetworkId | null
    ?? detectNetworkFromRequest(request);
  const networkId = networkForChain(requestedNetwork, "solana");
  const config = getVaultNetworkConfig(
    networkId,
    getNetworkConfig(networkId),
    "verified",
  );

  const response = await fetch(
    `${config.backend.url.replace(/\/+$/, "")}/api/access-requests`,
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
