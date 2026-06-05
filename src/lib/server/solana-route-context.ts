import type { NextRequest } from "next/server";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  networkChain,
  type NetworkConfig,
} from "@/lib/network-config";

export function resolveSolanaRouteConfig(
  request: NextRequest,
  routeName: string,
): { config: NetworkConfig } | { error: string; status: number } {
  const network = detectNetworkFromRequest(request);
  if (networkChain(network) !== "sol") {
    return {
      error: `${routeName} is only available on Solana networks.`,
      status: 400,
    };
  }
  return {
    config: getNetworkConfig(network, { applyEnvOverrides: false }),
  };
}
