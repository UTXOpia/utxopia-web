import { NextRequest, NextResponse } from "next/server";
import { networkForChain } from "@/lib/chain-registry";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  type NetworkId,
} from "@/lib/network-config";
import {
  getVaultNetworkConfig,
  parseVaultId,
} from "@/lib/vault-config";
import { applyBackendAuthHeaders } from "@/lib/server/backend-auth";

export const dynamic = "force-dynamic";

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ id: string }> },
) {
  const { id } = await context.params;
  const requestedNetwork = request.nextUrl.searchParams.get("network") as NetworkId | null
    ?? detectNetworkFromRequest(request);
  const networkId = networkForChain(requestedNetwork, "solana");
  const vaultId = parseVaultId(request.nextUrl.searchParams.get("vault"));
  const config = getVaultNetworkConfig(
    networkId,
    getNetworkConfig(networkId),
    vaultId,
  );
  const response = await fetch(
    `${config.backend.url.replace(/\/+$/, "")}/api/policy/requests/${encodeURIComponent(id)}/submission`,
    {
      method: "POST",
      headers: applyBackendAuthHeaders({ "Content-Type": "application/json" }),
      body: await request.text(),
      cache: "no-store",
    },
  );
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return NextResponse.json(
    response.ok
      ? {
          requestId: body.requestId,
          stage: body.stage,
          ...(typeof body.error === "string" ? { error: body.error } : {}),
        }
      : body,
    { status: response.status },
  );
}
