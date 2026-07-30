/**
 * Network configuration — single source of truth for all addresses.
 *
 * Reads network transport configuration from networks.json. Vault pool
 * identities are applied independently at runtime by vault-config.ts.
 *
 * Only RPC URL and backend URL can be overridden via env vars
 * (for custom RPC providers or local development).
 */

import networksJson from "./networks.json";
import { CHAIN_ADAPTERS } from "@/lib/chain-registry";
import { getVaultRuntimeConfig, vaultsSupported } from "@/lib/vault-config";

export type NetworkId =
  | "devnet"
  | "devnet-regtest"
  | "testnet"
  | "mainnet"
  | "localnet";

export type ChainQuery = "sol";

export interface NetworkConfig {
  chain?: "solana";
  solana: {
    rpcUrl: string;
    utxopiaProgramId: string;
    btcLightClientId: string;
    chadbufferId: string;
    /** If true, value-entry (deposits/shields) require the auditor's co-signature. */
    permissioned?: boolean;
    /** Base58-encoded auditor viewing pubkey (Solana). Absent ⇒ not permissioned. */
    auditorViewingPubkey?: string;
    /** Fixed active vault identity, applied from the runtime vault registry. */
    poolState?: string;
    commitmentTree?: string;
    policyProgramId?: string;
  };
  tokens: {
    zkbtcMint: string;
    usdcMint: string;
    usdtMint: string;
    wsolMint: string;
  };
  bitcoin: {
    network: string;
    poolAddress: string;
    groupPubkey: string;
    depositMode?: "sweep" | "direct" | "direct_vault" | "ika_direct";
    explorerUrl: string;
  };
  ika?: {
    programId: string;
    grpcEndpoint: string;
    dwallet: string;
    dwalletXOnlyPubkey: string;
  };
  backend: {
    url: string;
  };
  sns?: {
    nameServiceProgramId: string;
    registrarProgramId: string;
    subRegistrarProgramId: string;
    rootDomain: string;
    parentDomain: string;
    reverseLookupClass: string;
    stealthDataVersion: number;
  };
}

/** Display metadata for each network — surfaced in /settings so users
 *  understand which stack they're switching into. */
export interface NetworkMeta {
  id: NetworkId;
  label: string;
  /** Short tagline shown next to the radio button. */
  tagline: string;
  /** One-paragraph description of what this network is + what works. */
  description: string;
  /** Notable caveats / known limitations. */
  caveats: string[];
  /** Whether this network is generally usable (e.g. has a deployed program). */
  enabled: boolean;
  /** Shown in the selector but not yet selectable — renders a "Coming soon" badge. */
  comingSoon?: boolean;
}

export const NETWORK_META: NetworkMeta[] = [
  {
    id: "devnet",
    label: "Devnet",
    tagline: "Solana devnet + Bitcoin testnet4",
    description: "Legacy testnet4 stack. Not supported for alpha while BTC header relay is disabled.",
    caveats: [
      "Unsupported: use Hybrid for Solana devnet + local regtest BTC.",
    ],
    enabled: false,
    comingSoon: true,
  },
  {
    id: "devnet-regtest",
    label: "Hybrid",
    tagline: "Solana devnet + local regtest BTC",
    description: "Same on-chain model as production. Blocks mine instantly — full loop in seconds.",
    caveats: [
      "Local regtest BTC; state resets with the docker stack.",
    ],
    enabled: true,
  },
  {
    id: "localnet",
    label: "Localnet",
    tagline: "Surfpool validator + regtest",
    description:
      "Fully local stack: Surfpool offline validator, regtest BTC, programs deployed via txtx runbook. Used by the E2E test suite — not surfaced as an end-user option.",
    caveats: ["Requires `surfpool start -y --offline` running locally."],
    enabled: false,
  },
  {
    id: "testnet",
    label: "Testnet",
    tagline: "(not deployed)",
    description: "Reserved for a future Solana testnet deployment.",
    caveats: ["Program IDs not yet populated."],
    enabled: false,
  },
  {
    id: "mainnet",
    label: "Mainnet",
    tagline: "(not deployed)",
    description: "Reserved for the eventual mainnet launch.",
    caveats: ["Not deployed."],
    enabled: false,
  },
];

const networks = networksJson as Record<NetworkId, NetworkConfig>;

const STORAGE_KEY = "utxopia.network";
/** Cookie name — same key, browser-readable, sent on every same-origin request
 *  so server-side API routes can route to the right backend per request. */
const COOKIE_NAME = "utxopia.network";
export const NETWORK_CHANGE_EVENT = "utxopia:network-change";

function isKnownNetwork(value: string | null | undefined): value is NetworkId {
  return !!value && value in networks;
}

function isSupportedNetwork(value: NetworkId | null | undefined): value is NetworkId {
  if (!value) return false;
  const meta = NETWORK_META.find((item) => item.id === value);
  return meta?.enabled === true;
}

export function networkChain(_network: NetworkId): ChainQuery {
  return "sol";
}

function defaultNetworkForChain(chain: ChainQuery): NetworkId {
  const env = process.env.NEXT_PUBLIC_NETWORK || process.env.UTXOPIA_NETWORK;
  const adapter = Object.values(CHAIN_ADAPTERS).find((item) => item.query === chain) ?? CHAIN_ADAPTERS.solana;
  const envNetwork = env && adapter.networkIds.includes(env as NetworkId)
    ? env as NetworkId
    : null;
  if (isSupportedNetwork(envNetwork)) return envNetwork;
  if (isSupportedNetwork(adapter.hybridNetwork)) return adapter.hybridNetwork;
  return adapter.defaultNetwork;
}

function normalizeChainQuery(value: string | null): ChainQuery | null {
  if (value === "sol" || value === "solana") return "sol";
  return null;
}

function networkFromQuery(params: URLSearchParams, preferred?: NetworkId | null): NetworkId | null {
  const chain = normalizeChainQuery(params.get("chain"));
  const exact = params.get("network");
  if (isKnownNetwork(exact) && isSupportedNetwork(exact) && (!chain || networkChain(exact) === chain)) {
    return exact;
  }
  if (chain === "sol") {
    if (preferred && networkChain(preferred) === chain) return preferred;
    return defaultNetworkForChain(chain);
  }
  return null;
}

export function chainQueryForNetwork(network: NetworkId): ChainQuery {
  return networkChain(network);
}

export function hrefWithChain(href: string, network: NetworkId): string {
  const chain = chainQueryForNetwork(network);
  if (href.startsWith("http://") || href.startsWith("https://") || href.startsWith("#")) {
    return href;
  }
  const [pathAndSearch, hash = ""] = href.split("#");
  const [path, search = ""] = pathAndSearch.split("?");
  const params = new URLSearchParams(search);
  params.set("chain", chain);
  params.set("network", network);
  const query = params.toString();
  return `${path}${query ? `?${query}` : ""}${hash ? `#${hash}` : ""}`;
}

/** Parse our cookie value out of an HTTP `Cookie:` header. */
export function parseNetworkCookie(cookieHeader: string | null): NetworkId | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.trim().split("=");
    if (k === COOKIE_NAME && isKnownNetwork(v)) return v;
  }
  return null;
}

/** Server-side helper: resolve the network for a single request based on its
 *  cookies. Falls back to env-var default. Use this in API routes instead of
 *  the bare `detectNetwork()` (which only knows about the build-time env). */
export function detectNetworkFromRequest(req: Request): NetworkId {
  const url = new URL(req.url);
  const cookieNet = parseNetworkCookie(req.headers.get("cookie"));
  const queryNet = networkFromQuery(url.searchParams, cookieNet);
  if (queryNet) return queryNet;
  if (isSupportedNetwork(cookieNet)) return cookieNet;
  return detectNetwork();
}

export function detectNetwork(): NetworkId {
  // 1. localStorage (per-browser user preference, set via /settings)
  if (typeof window !== "undefined") {
    const params = new URLSearchParams(window.location.search);
    let stored: NetworkId | null = null;

    try {
      const rawStored = window.localStorage.getItem(STORAGE_KEY);
      if (isKnownNetwork(rawStored)) stored = rawStored;
    } catch {
      // localStorage may be unavailable (SSR, privacy mode) — fall through.
    }

    // 2. cookie fallback (in case localStorage was cleared but cookie remains)
    const cookieNet = parseNetworkCookie(document.cookie);
    const preferred = stored ?? cookieNet;
    const queryNet = networkFromQuery(params, preferred);
    if (queryNet) return queryNet;
    if (isSupportedNetwork(stored)) return stored;
    if (isSupportedNetwork(cookieNet)) return cookieNet;
  }

  // 3. env vars (build-time default)
  const env =
    process.env.NEXT_PUBLIC_NETWORK ||
    process.env.UTXOPIA_NETWORK ||
    "devnet";
  if (env === "mainnet" || env === "mainnet-beta") return isSupportedNetwork("mainnet") ? "mainnet" : "devnet-regtest";
  if (env === "testnet") return isSupportedNetwork("testnet") ? "testnet" : "devnet-regtest";
  if (env === "localnet") return "localnet";
  if (env === "devnet-regtest" || env === "hybrid") return "devnet-regtest";
  return "devnet-regtest";
}

/** Persist the user's network choice. Writes both localStorage (so client-only
 *  reads stay synchronous) and a cookie (so server-side API routes can resolve
 *  the right backend per request). Caller still needs to reload the page if
 *  long-lived modules captured a previous value. */
export function setNetwork(network: NetworkId): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, network);
  } catch {
    // ignore — best-effort
  }
  try {
    // 1 year, same-site lax (sent on top-level navigation + XHR to same origin)
    const maxAge = 60 * 60 * 24 * 365;
    document.cookie = `${COOKIE_NAME}=${network}; Path=/; Max-Age=${maxAge}; SameSite=Lax`;
  } catch {
    // ignore
  }
  try {
    window.dispatchEvent(new CustomEvent(NETWORK_CHANGE_EVENT, { detail: network }));
  } catch {
    // ignore
  }
}

export interface GetNetworkConfigOptions {
  /** When false, skip env-var overrides so networks.json is returned as-is.
   *  Use this when the caller has already decided which network they want and
   *  doesn't want BACKEND_API_URL / SOLANA_RPC_URL to silently shadow the
   *  per-network value (e.g. multi-network deployments via cookie). */
  applyEnvOverrides?: boolean;
}

export function getNetworkConfig(
  network?: NetworkId,
  options: GetNetworkConfigOptions = {},
): NetworkConfig {
  const { applyEnvOverrides = true } = options;
  const net = network ?? detectNetwork();
  let cfg = { ...networks[net] };
  if (!cfg) throw new Error(`Unknown network: ${net}`);

  // On dual-vault networks the pool fields come from the vault table, not the
  // JSON copy. Pool-unaware code paths read this config, and a stale copy
  // points them at a pool that no longer exists without failing loudly.
  if (vaultsSupported(net)) {
    // Pool identity only. Backend routing stays with the explicit ?vault=
    // param, so an unscoped request keeps hitting the unscoped backend.
    const openVault = getVaultRuntimeConfig(net, "open");
    cfg = {
      ...cfg,
      solana: {
        ...cfg.solana,
        utxopiaProgramId: openVault.programId,
        poolState: openVault.poolState,
        commitmentTree: openVault.commitmentTree,
      },
      tokens: { ...cfg.tokens, zkbtcMint: openVault.mint },
    };
  }

  if (!applyEnvOverrides) return cfg;

  // Allow env var overrides for URLs only. Server-only SOLANA_RPC_URL takes
  // precedence over NEXT_PUBLIC_SOLANA_RPC_URL so a keyed backend RPC can be used
  // server-side while the browser (where SOLANA_RPC_URL is always undefined)
  // falls through to the public NEXT_PUBLIC_ value — keeping the key off clients.
  const rpcOverride =
    process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL;
  if (rpcOverride) cfg.solana = { ...cfg.solana, rpcUrl: rpcOverride };

  const backendOverride =
    process.env.NEXT_PUBLIC_BACKEND_URL || process.env.BACKEND_URL || process.env.BACKEND_API_URL;
  if (backendOverride) cfg.backend = { ...cfg.backend, url: backendOverride };

  return cfg;
}
