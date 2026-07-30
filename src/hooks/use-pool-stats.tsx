"use client";

/**
 * Pool Statistics Hook
 *
 * Fetches from backend /api/pool/stats (cached by reconciler, ~30s).
 * Single fetch replaces 5+ client-side RPC calls.
 */

import useSWR from "swr";
import type { NetworkId } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getTokenBySymbol } from "@/lib/supported-tokens";
import { buildTokenIdMap } from "@/lib/token-map";
import { vaultsSupported, type VaultId } from "@/lib/vault-config";

/** Per-token TVL info */
export interface TokenTVL {
  symbol: string;
  shieldedSymbol: string;
  totalShielded: bigint;
  decimals: number;
}

export interface PoolStats {
  totalShielded: bigint;
  depositCount: number;
  totalCommitments: number;
  volume: bigint;
  tokenTVL: TokenTVL[];
}

async function fetchPoolStats(network: NetworkId, vault?: VaultId): Promise<PoolStats> {
  const query = new URLSearchParams({ network });
  if (vault) query.set("vault", vault);
  const resp = await fetch(`/api/pool/stats?${query.toString()}`, {
    signal: AbortSignal.timeout(5000),
  });

  if (!resp.ok) {
    throw new Error(`Pool stats request failed (${resp.status})`);
  }

  const data = await resp.json();
  const oc = data.onChain;

  if (!oc) {
    throw new Error("Pool stats returned an invalid response");
  }

  const totalShielded = BigInt(oc.totalShielded ?? 0);
  const totalMinted = BigInt(oc.totalMinted ?? 0);
  const totalBurned = BigInt(oc.totalBurned ?? 0);

  // Parse per-token TVL from backend
  const tokenTVL: TokenTVL[] = [];
  const backendTVL: { tokenId: string; totalShielded: number }[] = data.tokenTVL ?? [];

  if (backendTVL.length > 0) {
    const idMap = await buildTokenIdMap();
    for (const entry of backendTVL) {
      // Backend returns tokenId as hex from SQLite hex() — try both cases
      const hex = entry.tokenId.toLowerCase().padStart(64, "0");
      const symbol = idMap.get(hex) ?? idMap.get(entry.tokenId.toUpperCase().padStart(64, "0"));
      const token = symbol ? getTokenBySymbol(symbol) : null;
      if (token && entry.totalShielded > 0) {
        tokenTVL.push({
          symbol: token.symbol,
          shieldedSymbol: token.shieldedSymbol,
          totalShielded: BigInt(entry.totalShielded),
          decimals: token.decimals,
        });
      }
    }
  }

  // Fallback: if backend has no per-token data but on-chain shows shielded BTC
  if (tokenTVL.length === 0 && totalShielded > 0n) {
    tokenTVL.push({
      symbol: "BTC",
      shieldedSymbol: "zkBTC",
      totalShielded,
      decimals: 8,
    });
  }

  return {
    totalShielded,
    depositCount: Number(oc.depositCount ?? 0),
    totalCommitments: Number(oc.treeNextIndex ?? 0),
    volume: totalMinted + totalBurned,
    tokenTVL,
  };
}

/** Sum per-token TVL across pools, keyed by shielded symbol. */
function mergePoolStats(parts: PoolStats[]): PoolStats {
  const bySymbol = new Map<string, TokenTVL>();
  for (const part of parts) {
    for (const entry of part.tokenTVL) {
      const existing = bySymbol.get(entry.shieldedSymbol);
      if (existing) existing.totalShielded += entry.totalShielded;
      else bySymbol.set(entry.shieldedSymbol, { ...entry });
    }
  }
  return {
    totalShielded: parts.reduce((sum, p) => sum + p.totalShielded, 0n),
    depositCount: parts.reduce((sum, p) => sum + p.depositCount, 0),
    totalCommitments: parts.reduce((sum, p) => sum + p.totalCommitments, 0),
    volume: parts.reduce((sum, p) => sum + p.volume, 0n),
    tokenTVL: [...bySymbol.values()],
  };
}

/**
 * @param vault Pool scope. Omit for the network's default pool (unchanged
 *   behaviour); "all" sums every pool on dual-vault networks.
 */
export function usePoolStats(networkId?: NetworkId, vault?: VaultId | "all") {
  const env = useChainEnvironment();
  const network = networkId ?? env.networkId;
  const scope: VaultId | "all" | "default" = vault ?? "default";
  const { data: stats, error, isLoading, mutate } = useSWR<PoolStats>(
    ["pool-stats", network, scope],
    () => {
      if (scope === "default" || !vaultsSupported(network)) return fetchPoolStats(network);
      if (scope === "all") {
        return Promise.all([
          fetchPoolStats(network, "open"),
          fetchPoolStats(network, "verified"),
        ]).then(mergePoolStats);
      }
      return fetchPoolStats(network, scope);
    },
    {
      refreshInterval: 30000,
      dedupingInterval: 10000,
      revalidateOnFocus: false,
      errorRetryCount: 3,
    },
  );

  return {
    stats: stats ?? null,
    isLoading,
    error: error ? (error instanceof Error ? error.message : "Failed to fetch stats") : null,
    refresh: () => mutate(),
  };
}
