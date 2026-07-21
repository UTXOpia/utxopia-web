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
  PUBLIC_ZKBTC_BALANCE: (owner: string) =>
    `/api/public-zkbtc-balance?owner=${encodeURIComponent(owner)}`,
} as const;

import { getNetworkConfig, type NetworkId } from "../network-config";

export const DEFAULT_API_URL = "http://localhost:3001";

/** Default Solana RPC URL used when no env var or Helius key is configured */
export const SOLANA_RPC_FALLBACK_URL = "https://api.devnet.solana.com";

/**
 * Get the Solana RPC URL (server-side).
 *
 * Priority: SOLANA_RPC_URL (server-only, keyed) > NEXT_PUBLIC_SOLANA_RPC_URL > devnet fallback.
 * Server-only wins so a keyed backend RPC stays off the browser bundle.
 */
export function getSolanaRpcUrl(): string {
  return process.env.SOLANA_RPC_URL || process.env.NEXT_PUBLIC_SOLANA_RPC_URL || SOLANA_RPC_FALLBACK_URL;
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
