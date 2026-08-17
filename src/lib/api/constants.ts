import { getNetworkConfig, type NetworkId } from "../network-config";

/**
 * API Constants
 *
 * Minimal endpoints for backend communication:
 * - Redemption (BTC withdrawal) - requires server-side BTC signing
 * - Header status - checks on-chain header existence
 *
 * Note: Deposit/claim operations use SDK directly (no backend API)
 * Note: Header submission uses the backend header-relayer service (batch only)
 */

export const API_ENDPOINTS = {
  WITHDRAWAL_STATUS: (id: string) => `/api/withdrawal/status/${encodeURIComponent(id)}`,

  // Block header status (Next.js API route -> Solana RPC)
  HEADER_STATUS: (height: number) => `/api/header/status/${height}`,
  PUBLIC_ZKBTC_BALANCE: (owner: string, network?: NetworkId) => {
    const params = new URLSearchParams({ owner });
    if (network) params.set("network", network);
    return `/api/public-zkbtc-balance?${params.toString()}`;
  },
} as const;

export const DEFAULT_API_URL = "http://localhost:3001";

/** Default Solana RPC URL used when no env var or Helius key is configured */
export const SOLANA_RPC_FALLBACK_URL = "https://api.devnet.solana.com";

/** Same-origin JSON-RPC proxy the browser uses instead of a keyed RPC URL. */
export const BROWSER_RPC_PATH = "/api/rpc";

/**
 * Get the Solana RPC URL.
 *
 * In the browser this is always the same-origin proxy: a keyed URL in
 * `NEXT_PUBLIC_SOLANA_RPC_URL` would ship inside the client bundle, and the
 * tokenless form of a keyed endpoint answers 403. Server-side, the keyed
 * `SOLANA_RPC_URL` wins so the token stays off the client entirely.
 */
export function getSolanaRpcUrl(): string {
  if (typeof window !== "undefined") return `${window.location.origin}${BROWSER_RPC_PATH}`;
  return process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || SOLANA_RPC_FALLBACK_URL;
}

/**
 * Websocket endpoint for the browser. Subscriptions can't go through the HTTP
 * proxy, so this needs a directly reachable host — set
 * `NEXT_PUBLIC_SOLANA_WS_URL` to one that accepts browser origins. Falls back
 * to the public cluster, which is rate-limited but works.
 */
export function getSolanaWsUrl(): string {
  const explicit = process.env.NEXT_PUBLIC_SOLANA_WS_URL;
  if (explicit) return explicit;
  return SOLANA_RPC_FALLBACK_URL.replace(/^http/, "ws");
}

/**
 * Get the backend API URL.
 *
 * Pass an explicit `network` to resolve a specific stack (used by server-side
 * API routes that read the network from a request cookie via
 * `detectNetworkFromRequest`). Without it we use the build-time / browser-
 * detected default.
 *
 * When `network` is given, networks.json is the source of truth — env vars
 * are only the default when the caller didn't specify (so multi-network
 * deployments can still pick per-request).
 *
 * Priority (no network arg): env var override > networks.json default > localhost
 * Priority (network arg given): networks.json[network] > env var override > localhost
 */
export function getBackendUrl(network?: NetworkId): string {
  if (typeof network !== "undefined") {
    // Caller is explicit about which stack; read networks.json directly so a
    // BACKEND_API_URL env var (set for the default stack) doesn't shadow the
    // per-network value.
    const rawUrl = getNetworkConfig(network, { applyEnvOverrides: false })
      .backend.url;
    return rawUrl || (typeof window === "undefined"
      ? process.env.BACKEND_API_URL
      : process.env.NEXT_PUBLIC_BACKEND_API_URL) || DEFAULT_API_URL;
  }
  const cfgUrl = getNetworkConfig().backend.url;
  if (typeof window === "undefined") {
    return process.env.BACKEND_API_URL || cfgUrl || DEFAULT_API_URL;
  }
  return process.env.NEXT_PUBLIC_BACKEND_API_URL || cfgUrl || DEFAULT_API_URL;
}
