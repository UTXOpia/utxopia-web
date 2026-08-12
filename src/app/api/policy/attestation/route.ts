import { NextRequest, NextResponse } from "next/server";
import { networkForChain } from "@/lib/chain-registry";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  type NetworkId,
} from "@/lib/network-config";
import { getVaultNetworkConfig, parseVaultId } from "@/lib/vault-config";
import { applyBackendAuthHeaders } from "@/lib/server/backend-auth";

export const dynamic = "force-dynamic";

/**
 * Field allowlist, same contract as `publicStatus` in the requests route: the
 * backend body is never forwarded whole. A TDX measurement and its TCB status
 * are public by construction, but a field added to `Attestation` later must not
 * reach the browser just because nobody re-read this file.
 */
function publicAttestation(body: Record<string, unknown>) {
  const rtmr = Array.isArray(body.rtmr)
    ? body.rtmr.filter((value): value is string => typeof value === "string")
    : [];
  const advisoryIds = Array.isArray(body.advisoryIds)
    ? body.advisoryIds.filter((value): value is string => typeof value === "string")
    : [];
  return {
    measurement: typeof body.measurement === "string" ? body.measurement : "",
    mrTd: typeof body.mrTd === "string" ? body.mrTd : "",
    rtmr,
    tcbStatus: typeof body.tcbStatus === "string" ? body.tcbStatus : "",
    advisoryIds,
    pinned: body.pinned === true,
    verifiedAt: typeof body.verifiedAt === "number" ? body.verifiedAt : 0,
  };
}

export async function GET(request: NextRequest) {
  const requestedNetwork =
    (request.nextUrl.searchParams.get("network") as NetworkId | null) ??
    detectNetworkFromRequest(request);
  const networkId = networkForChain(requestedNetwork, "solana");
  const vaultId = parseVaultId(request.nextUrl.searchParams.get("vault"));
  const config = getVaultNetworkConfig(
    networkId,
    getNetworkConfig(networkId),
    vaultId,
  );
  if (!config.solana.permissioned) {
    return NextResponse.json(
      { error: "Open Privacy has no policy enclave" },
      { status: 400 },
    );
  }

  // `force` costs a live quote from the enclave plus a collateral fetch from
  // Phala's PCCS, so it is passed through rather than defaulted on. The backend
  // floors how often it will actually re-attest.
  const force = request.nextUrl.searchParams.get("force") === "true";
  const response = await fetch(
    `${config.backend.url.replace(/\/+$/, "")}/api/policy/attestation${force ? "?force=true" : ""}`,
    {
      headers: applyBackendAuthHeaders({ Accept: "application/json" }),
      cache: "no-store",
    },
  );
  const body = (await response.json().catch(() => ({}))) as Record<string, unknown>;
  if (!response.ok) {
    return NextResponse.json(body, { status: response.status });
  }
  return NextResponse.json(publicAttestation(body));
}
