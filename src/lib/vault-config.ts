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

const DEVNET_REGTEST_VAULT_SEEDS: Record<VaultId, VaultSeed> = {
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

/** Solana devnet + Bitcoin testnet4, deployed 2026-08-26. A separate program
 *  and separate pools from devnet-regtest — nothing here may be reused there. */
const DEVNET_VAULT_SEEDS: Record<VaultId, VaultSeed> = {
  open: {
    id: "open",
    name: "Open Privacy",
    description: "Anyone can use it. No invite, no approval.",
    permissioned: false,
    policyMode: "disabled",
    programId: "28z2AtKA6aFGrGCh4ns1rmp7vGpWuh6x3H7gXKBcfxur",
    mint: "87zWstDnNgMig2vk8q8jTrK6YTcyugeRTanfT3LfyU3T",
    backendPath: "/open",
    btcAddress: "tb1p8f4tszapf0q9puzgaclqka7cjddd7n79ut6eguc37fkv9j6m6x2qtcnqsg",
    btcGroupPubkey: "3a6ab80ba14bc050f048ee3e0b77d8935adf4fc5e2f5947311f26cc2cb5bd194",
    ikaDwallet: "GmRpTRLuSFK6axmMyeUuGRzHD92NiGx48qDw49kT2sko",
  },
  verified: {
    id: "verified",
    name: "Verified Privacy",
    description: "Invite only. Your wallet must be on the operator's allowlist.",
    permissioned: true,
    policyMode: "per",
    programId: "28z2AtKA6aFGrGCh4ns1rmp7vGpWuh6x3H7gXKBcfxur",
    policyProgramId: "9asWYKVriWGpExW5xM44ChHjZtispkLCiWKkM8SQi8Rs",
    mint: "G78CTddWGDaNaSKQayAt7m3pzcMyaUNxgR8y3R34YvEv",
    backendPath: "/verified",
    btcAddress: "tb1pzmzk8w4pr07gl6f6etlglctfh92t86knand8w4xxzh0vn6zqkkjskx9ll6",
    btcGroupPubkey: "16c563baa11bfc8fe93acafe8fe169b954b3ead3ecda7754c615dec9e840b5a5",
    ikaDwallet: "5pWCLBcusnUVdfamJWtW3UtpySRQagvKxestVqwR4tzj",
  },
};

/** Every deployment that runs dual vaults. `vaultsSupported` is membership in
 *  this table, not a hardcoded network id — a second environment was exactly
 *  the case the old single-table shape could not express. */
const VAULT_SEEDS: Partial<Record<NetworkId, Record<VaultId, VaultSeed>>> = {
  "devnet-regtest": DEVNET_REGTEST_VAULT_SEEDS,
  devnet: DEVNET_VAULT_SEEDS,
};

// Keyed by network too: both deployments have an "open" vault, and caching on
// the vault id alone would serve whichever network resolved first to both.
const derived = new Map<string, VaultRuntimeConfig>();

/** Resolve a vault's PDAs once. Deriving beats storing: a stored address can
 *  drift from the program and mint it is supposed to belong to, and nothing
 *  fails loudly when it does. */
function resolveVault(networkId: NetworkId, seed: VaultSeed): VaultRuntimeConfig {
  const key = `${networkId}:${seed.id}`;
  const cached = derived.get(key);
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
  derived.set(key, resolved);
  return resolved;
}

export function parseVaultId(value: string | null | undefined): VaultId {
  return value?.trim().toLowerCase() === "verified" ? "verified" : "open";
}

/** Every pool's zkBTC mint. Each vault mints its own, so anything resolving
 *  token ids across pools (explorer TVL, merged feeds) needs all of them. */
export function allVaultZkbtcMints(): string[] {
  // Every network's mints, not just the active one: a mint is globally unique,
  // and this feeds a lookup table that is cheaper to over-fill than to miss.
  return Object.values(VAULT_SEEDS).flatMap((vaults) =>
    Object.values(vaults).map((vault) => vault.mint),
  );
}

/** Dual vaults exist only on deployments listed in VAULT_SEEDS. Claiming
 *  support for a network with no entry would hand out another deployment's
 *  pool addresses. */
export function vaultsSupported(networkId: NetworkId): boolean {
  return networkId in VAULT_SEEDS;
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
  const vaults = VAULT_SEEDS[networkId];
  if (!vaults) {
    throw new Error(
      `Dual privacy vaults are not configured on "${networkId}" — have: ${Object.keys(VAULT_SEEDS).join(", ")}`,
    );
  }
  return resolveVault(networkId, vaults[vaultId]);
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
