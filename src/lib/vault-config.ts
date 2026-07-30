import { PublicKey } from "@solana/web3.js";
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

/** Stored vault facts. The pool and tree addresses are PDAs of these, so they
 *  are derived rather than written down twice. */
type VaultSeed = Omit<VaultRuntimeConfig, "poolState" | "commitmentTree">;

const DEVNET_VAULT_SEEDS: Record<VaultId, VaultSeed> = {
  open: {
    id: "open",
    name: "Open Privacy",
    description: "Permissionless private transfers on Solana.",
    permissioned: false,
    policyMode: "disabled",
    programId: "CvfSyACR8xemPdeJsB3D8Xh15rKUQ3b5c1PvnmABCBJp",
    mint: "GuruxfN5irYcCyDiKFMeDRTNbP2WeHF1oWjQ8q8Esc16",
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
    backendPath: "/verified",
  },
};

const POOL_STATE_SEED = "pool_state";
const COMMITMENT_TREE_SEED = "commitment_tree";
const derived = new Map<VaultId, VaultRuntimeConfig>();

/** Resolve a vault's PDAs once. Deriving beats storing: a stored address can
 *  drift from the program and mint it is supposed to belong to, and nothing
 *  fails loudly when it does. */
function resolveVault(seed: VaultSeed): VaultRuntimeConfig {
  const cached = derived.get(seed.id);
  if (cached) return cached;

  const programId = new PublicKey(seed.programId);
  const [poolState] = PublicKey.findProgramAddressSync(
    [Buffer.from(POOL_STATE_SEED), new PublicKey(seed.mint).toBuffer()],
    programId,
  );
  const treeIndex = Buffer.alloc(4); // tree 0; rotation picks later indices on chain
  const [commitmentTree] = PublicKey.findProgramAddressSync(
    [Buffer.from(COMMITMENT_TREE_SEED), poolState.toBuffer(), treeIndex],
    programId,
  );

  const resolved: VaultRuntimeConfig = {
    ...seed,
    poolState: poolState.toBase58(),
    commitmentTree: commitmentTree.toBase58(),
  };
  derived.set(seed.id, resolved);
  return resolved;
}

export function parseVaultId(value: string | null | undefined): VaultId {
  return value?.trim().toLowerCase() === "verified" ? "verified" : "open";
}

/** Every pool's zkBTC mint. Each vault mints its own, so anything resolving
 *  token ids across pools (explorer TVL, merged feeds) needs all of them. */
export function allVaultZkbtcMints(): string[] {
  return Object.values(DEVNET_VAULT_SEEDS).map((vault) => vault.mint);
}

/** Dual vaults exist on one deployment only. Plain devnet runs a different
 *  program and mint, so claiming vault support there would hand out this
 *  deployment's pool addresses for someone else's pool. */
export function vaultsSupported(networkId: NetworkId): boolean {
  return networkId === "devnet-regtest";
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
  if (!vaultsSupported(networkId)) {
    throw new Error("Dual privacy vaults are available on UTXOpia Devnet (regtest) only");
  }
  return resolveVault(DEVNET_VAULT_SEEDS[vaultId]);
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
