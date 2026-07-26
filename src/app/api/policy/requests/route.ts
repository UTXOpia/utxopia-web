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

function publicStatus(body: Record<string, unknown>) {
  return {
    requestId: body.requestId,
    stage: body.stage,
    ...(typeof body.approvalAccount === "string"
      ? { approvalAccount: body.approvalAccount }
      : {}),
    ...(typeof body.error === "string" ? { error: body.error } : {}),
  };
}

export async function POST(request: NextRequest) {
  const requestedNetwork = request.nextUrl.searchParams.get("network") as NetworkId | null
    ?? detectNetworkFromRequest(request);
  const networkId = networkForChain(requestedNetwork, "solana");
  const vaultId = parseVaultId(request.nextUrl.searchParams.get("vault"));
  const config = getVaultNetworkConfig(
    networkId,
    getNetworkConfig(networkId),
    vaultId,
  );
  if (!config.solana.permissioned) {
    return NextResponse.json(
      { error: "Open Privacy does not use policy approval" },
      { status: 400 },
    );
  }

  const response = await fetch(
    `${config.backend.url.replace(/\/+$/, "")}/api/policy/requests`,
    {
      method: "POST",
      headers: applyBackendAuthHeaders({ "Content-Type": "application/json" }),
      body: await request.text(),
      cache: "no-store",
    },
  );
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  return NextResponse.json(
    response.ok ? publicStatus(body) : body,
    { status: response.status },
  );
}
