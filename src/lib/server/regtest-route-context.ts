import type { NextRequest } from "next/server";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  type NetworkConfig,
  type NetworkId,
} from "@/lib/network-config";

export function resolveRegtestRouteConfig(
  request: NextRequest,
): { network: NetworkId; config: NetworkConfig } | { error: string; status: number } {
  const network = detectNetworkFromRequest(request);
  const config = getNetworkConfig(network, { applyEnvOverrides: false });
  if (config.bitcoin.network !== "regtest") {
    return {
      error: `regtest helper only available on regtest; current network=${network}, btcNetwork=${config.bitcoin.network || "unknown"}`,
      status: 400,
    };
  }
  return { network, config };
}
