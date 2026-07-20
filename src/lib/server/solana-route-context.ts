import type { NextRequest } from "next/server";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  type NetworkConfig,
} from "@/lib/network-config";

/**
 * Resolves the config for a Solana Name Service route. SNS is a name-mapping
 * layer, not a pool operation, so the backend serves it on ANY network that
 * carries a complete `sns` block and a Solana RPC URL — including a Sui-primary
 * network that also publishes .utxopia.sol names (one backend, both name
 * systems). The UI remains network-scoped and only surfaces the current chain's
 * names; this guard governs backend availability, not what the UI shows.
 * Networks without SNS configured are rejected.
 */
export function resolveSolanaRouteConfig(
  request: NextRequest,
  routeName: string,
): { config: NetworkConfig } | { error: string; status: number } {
  const network = detectNetworkFromRequest(request);
  const config = getNetworkConfig(network, { applyEnvOverrides: false });
  const sns = config.sns;
  const hasSns = Boolean(
    sns?.nameServiceProgramId &&
      sns.registrarProgramId &&
      sns.subRegistrarProgramId &&
      sns.rootDomain &&
      sns.parentDomain &&
      sns.reverseLookupClass,
  );
  if (!hasSns || !config.solana?.rpcUrl) {
    return {
      error: `${routeName} requires Solana Name Service to be configured for this network.`,
      status: 400,
    };
  }
  return { config };
}
