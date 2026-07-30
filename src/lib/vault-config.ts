import type { NetworkConfig, NetworkId } from "@/lib/network-config";

export type VaultId = "open" | "verified";

export interface VaultRuntimeConfig {
  id: VaultId;
  name: string;
  description: string;
  permissioned: boolean;
  policyMode: "disabled" | "per";
  programId: string;
  mint: string;
  poolState: string;
  commitmentTree: string;
  policyProgramId?: string;
  backendPath: `/${string}`;
}

const DEVNET_VAULTS: Record<VaultId, VaultRuntimeConfig> = {
  open: {
    id: "open",
    name: "Open Privacy",
    description: "Permissionless private transfers on Solana.",
    permissioned: false,
    policyMode: "disabled",
    programId: "CvfSyACR8xemPdeJsB3D8Xh15rKUQ3b5c1PvnmABCBJp",
    mint: "GuruxfN5irYcCyDiKFMeDRTNbP2WeHF1oWjQ8q8Esc16",
    poolState: "9xeWc39r3Z176MUpMpaqCGJGneHMj4pfMRv9u6dp2Qgd",
    commitmentTree: "4FvM9dCzDvr39Xu5xRUQc6EEm3UjSikyWUY5Hzpc5C4A",
    backendPath: "/open",
  },
  verified: {
    id: "verified",
    name: "Verified Privacy",
    description: "Private transfers with allowlist policy approval.",
    permissioned: true,
    policyMode: "per",
    programId: "CvfSyACR8xemPdeJsB3D8Xh15rKUQ3b5c1PvnmABCBJp",
    policyProgramId: "9asWYKVriWGpExW5xM44ChHjZtispkLCiWKkM8SQi8Rs",
    mint: "8WzWMJi1a6fJutP9U5C9FYcjsD7ZBPnCvJh3ZKiM3Rmr",
    poolState: "7mS4wHAV24YSHZ5wzrUZkMBSSa2jywEMCJa6bLyDRKbh",
    commitmentTree: "HGEWkZ8ifmw3Wd84M93xpUC1epPkDmVuZcUKKU7vwCKZ",
    backendPath: "/verified",
  },
};

export function parseVaultId(value: string | null | undefined): VaultId {
  return value?.trim().toLowerCase() === "verified" ? "verified" : "open";
}

/** Every pool's zkBTC mint. Each vault mints its own, so anything resolving
 *  token ids across pools (explorer TVL, merged feeds) needs all of them. */
export function allVaultZkbtcMints(): string[] {
  return Object.values(DEVNET_VAULTS).map((vault) => vault.mint);
}

export function vaultsSupported(networkId: NetworkId): boolean {
  return networkId === "devnet" || networkId === "devnet-regtest";
}

export function siblingVaultId(vaultId: VaultId): VaultId {
  return vaultId === "open" ? "verified" : "open";
}

export function getVaultPrivacyDomain(
  vaultId: VaultId,
): "public" | "institution" {
  return vaultId === "verified" ? "institution" : "public";
}

export function getVaultRuntimeConfig(
  networkId: NetworkId,
  vaultId: VaultId,
): VaultRuntimeConfig {
  if (networkId !== "devnet" && networkId !== "devnet-regtest") {
    throw new Error("Dual privacy vaults are available on UTXOpia Devnet only");
  }
  return DEVNET_VAULTS[vaultId];
}

export function getVaultNetworkConfig(
  networkId: NetworkId,
  base: NetworkConfig,
  vaultId: VaultId,
): NetworkConfig {
  const vault = getVaultRuntimeConfig(networkId, vaultId);
  return {
    ...base,
    solana: {
      ...base.solana,
      utxopiaProgramId: vault.programId,
      permissioned: vault.permissioned,
      poolState: vault.poolState,
      commitmentTree: vault.commitmentTree,
      policyProgramId: vault.policyProgramId,
    },
    tokens: {
      ...base.tokens,
      zkbtcMint: vault.mint,
    },
    backend: {
      ...base.backend,
      url: `${base.backend.url.replace(/\/+$/, "")}${vault.backendPath}`,
    },
  };
}

export function hrefWithVault(href: string, vaultId: VaultId): string {
  const [pathAndSearch, hash = ""] = href.split("#");
  const [path, search = ""] = pathAndSearch.split("?");
  const params = new URLSearchParams(search);
  params.set("vault", vaultId);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}
