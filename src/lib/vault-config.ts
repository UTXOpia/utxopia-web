import { PublicKey } from "@solana/web3.js";
import type { NetworkConfig, NetworkId } from "@/lib/network-config";
import { derivePoolStatePDA, deriveCommitmentTreePDA } from "@/lib/solana/pdas";

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
  /** Per-vault BTC custody. Each vault has its own Ika dWallet, so its own
   *  taproot address — sharing one would mean sharing an indistinguishable
   *  UTXO set. */
  btcAddress: string;
  btcGroupPubkey: string;
  ikaDwallet: string;
}

/** Stored vault facts. The pool and tree addresses are PDAs of these, so they
 *  are derived rather than written down twice. */
type VaultSeed = Omit<VaultRuntimeConfig, "poolState" | "commitmentTree">;

const DEVNET_VAULT_SEEDS: Record<VaultId, VaultSeed> = {
  open: {
    id: "open",
    name: "Open Privacy",
    // User-facing: rendered by VaultExplainer at the pool pickers.
    description: "Anyone can use it. No invite, no approval.",
    permissioned: false,
    policyMode: "disabled",
    programId: "CvfSyACR8xemPdeJsB3D8Xh15rKUQ3b5c1PvnmABCBJp",
    mint: "BJ5SXA33qK8r8BxJD4nQPf72ae9bactiA2Zqo33EcvPu",
    backendPath: "/open",
    btcAddress: "bcrt1pysaxc36sf7pdz6r4fk5nj25ahjatnw0ec526vzfz07kyvs4j5fhsn4t4nf",
    btcGroupPubkey: "243a6c47504f82d168754da9392a9dbcbab9b9f9c515a609227fac4642b2a26f",
    ikaDwallet: "CEBgewq8EbxTMLqYxbwYyd23Cx2pxdYyyzXXRoAZTeBW",
  },
  verified: {
    id: "verified",
    name: "Verified Privacy",
    description: "Invite only. Your wallet must be on the operator's allowlist.",
    permissioned: true,
    policyMode: "per",
    programId: "CvfSyACR8xemPdeJsB3D8Xh15rKUQ3b5c1PvnmABCBJp",
    policyProgramId: "9asWYKVriWGpExW5xM44ChHjZtispkLCiWKkM8SQi8Rs",
    mint: "FxvPBTfQZdzNoAwyLg5mVxsVHfqhAqceDHHvcPamWhPg",
    backendPath: "/verified",
    btcAddress: "bcrt1p4e0v8p9vwp6afc3732fc92l28ukpyj0tf9c9ud3rajakawh047dqamndtn",
    btcGroupPubkey: "ae5ec384ac7075d4e23e8a9382abea3f2c1249eb49705e3623ecbb6ebaefaf9a",
    ikaDwallet: "E7GWP4qTCB4Y6LVw2JMioVKfZxSjBjKsQ75fdAAHLzX",
  },
};

const derived = new Map<VaultId, VaultRuntimeConfig>();

/** Resolve a vault's PDAs once. Deriving beats storing: a stored address can
 *  drift from the program and mint it is supposed to belong to, and nothing
 *  fails loudly when it does. */
function resolveVault(seed: VaultSeed): VaultRuntimeConfig {
  const cached = derived.get(seed.id);
  if (cached) return cached;

  const programId = new PublicKey(seed.programId);
  const [poolState] = derivePoolStatePDA(programId, new PublicKey(seed.mint));
  // tree 0; rotation picks later indices on chain
  const [commitmentTree] = deriveCommitmentTreePDA(programId, 0, poolState);

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
    // Without these the sibling vault inherited the primary's deposit address,
    // so its deposits would be watched at — and credited to — the wrong pool.
    bitcoin: {
      ...base.bitcoin,
      poolAddress: vault.btcAddress,
      groupPubkey: vault.btcGroupPubkey,
    },
    ika: base.ika && {
      ...base.ika,
      dwallet: vault.ikaDwallet,
      dwalletXOnlyPubkey: vault.btcGroupPubkey,
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
