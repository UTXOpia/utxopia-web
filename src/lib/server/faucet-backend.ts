import { getBackendUrl } from "@/lib/api/constants";
import type { NetworkConfig, NetworkId } from "@/lib/network-config";

/**
 * The backend that owns the vault being funded.
 *
 * Open and Verified are separate backend processes behind one host, each
 * validating a deposit against its own POOL_RECEIVE_ADDRESS, and the shared
 * host routes an unprefixed path to Open. So a Verified deposit sent to the
 * unscoped URL reaches Open, which does not recognise the address and answers
 * "faucet configuration is outdated; refresh the app before trying again" —
 * the vault-scoped config carries the /verified prefix that avoids that.
 *
 * Lives outside the route module because a Next.js route file may only export
 * handlers and route config.
 */
export function faucetBackendUrl(network: NetworkId, config?: NetworkConfig | null): string {
  return process.env.REGTEST_FAUCET_BACKEND_URL || config?.backend?.url || getBackendUrl(network);
}
