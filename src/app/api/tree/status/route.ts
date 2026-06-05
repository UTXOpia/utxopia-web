import { NextRequest } from "next/server";
import { proxyToBackend } from "@/lib/api/backend-proxy";
import { detectNetworkFromRequest, getNetworkConfig, networkChain } from "@/lib/network-config";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const network = detectNetworkFromRequest(req);

  if (networkChain(network) === "sui") {
    const { fetchSuiExplorerStats } = await import("@/lib/sui/explorer");
    const stats = await fetchSuiExplorerStats(
      getNetworkConfig(network, { applyEnvOverrides: false }),
    );

    return Response.json({
      success: true,
      source: "sui-events",
      synced: true,
      root: null,
      next_index: stats.totalCommitments,
      size: stats.totalCommitments,
      announcements: stats.totalCommitments,
      nullifiers: 0,
    });
  }

  return proxyToBackend(req, "/api/tree/status");
}
