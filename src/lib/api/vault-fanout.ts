/**
 * Vault fan-out for explorer routes.
 *
 * Open and Verified are separate on-chain pools served by separate backend
 * instances. Explorer views span both, so these routes resolve one backend URL
 * per requested vault and tag every row with its source pool.
 */

import { getBackendUrl } from "@/lib/api/constants";
import { getNetworkConfig, type NetworkId } from "@/lib/network-config";
import { getVaultNetworkConfig, vaultsSupported, type VaultId } from "@/lib/vault-config";

export interface VaultTarget {
  /** Null on networks without dual vaults — rows stay untagged there. */
  vaultId: VaultId | null;
  backendUrl: string;
}

/** Parse the `vault` query param: "all" | "open" | "verified" (default "all"). */
export function parseVaultScope(value: string | null): "all" | VaultId {
  const scope = value?.trim().toLowerCase();
  if (scope === "open" || scope === "verified") return scope;
  return "all";
}

/**
 * Backends to query for a request. Single untagged target on networks without
 * dual vaults, so mainnet behaviour is unchanged.
 */
export function vaultTargets(network: NetworkId, scope: "all" | VaultId): VaultTarget[] {
  if (!vaultsSupported(network)) {
    return [{ vaultId: null, backendUrl: getBackendUrl(network) }];
  }
  const base = getNetworkConfig(network, { applyEnvOverrides: false });
  const ids: VaultId[] = scope === "all" ? ["open", "verified"] : [scope];
  return ids.map((vaultId) => ({
    vaultId,
    backendUrl: getVaultNetworkConfig(network, base, vaultId).backend.url,
  }));
}

/** Stamp rows with their source vault (no-op for untagged targets). */
export function tagVault<T extends object>(rows: T[], vaultId: VaultId | null): T[] {
  if (!vaultId) return rows;
  return rows.map((row) => ({ ...row, vault: vaultId }));
}
