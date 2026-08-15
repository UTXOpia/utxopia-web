"use client";

/**
 * Per-token deposit/withdraw activity for the pool anonymity view.
 *
 * Scope matters: each vault runs its own indexer and its own tree, so these
 * numbers describe one pool. Never sum them across vaults — a crowd you are not
 * standing in does not hide you.
 */

import useSWR from "swr";
import type { DepositPoint } from "@/lib/anonymity";
import type { NetworkId } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getTokenBySymbol } from "@/lib/supported-tokens";
import { buildTokenIdMap } from "@/lib/token-map";
import type { VaultId } from "@/lib/vault-config";

export interface TokenActivity {
  symbol: string;
  shieldedSymbol: string;
  decimals: number;
  depositCount: number;
  withdrawCount: number;
  totalShielded: bigint;
  totalWithdrawn: bigint;
  deposits: DepositPoint[];
  /** The backend capped `deposits`; the distribution is a recent window only. */
  depositsTruncated: boolean;
}

interface RawToken {
  tokenId: string;
  depositCount: number;
  totalShielded: number;
  withdrawCount: number;
  totalWithdrawn: number;
  deposits: { amount: number; blockTime: number }[];
  depositsTruncated: boolean;
}

async function fetchTokenActivity(
  network: NetworkId,
  vault?: VaultId,
): Promise<TokenActivity[]> {
  const query = new URLSearchParams({ network });
  if (vault) query.set("vault", vault);
  const resp = await fetch(`/api/pool/token-activity?${query.toString()}`, {
    signal: AbortSignal.timeout(8000),
  });
  if (!resp.ok) throw new Error(`Token activity request failed (${resp.status})`);

  const data = await resp.json();
  const raw: RawToken[] = data.tokens ?? [];
  const idMap = await buildTokenIdMap();

  const out: TokenActivity[] = [];
  for (const entry of raw) {
    const hex = entry.tokenId.toLowerCase().padStart(64, "0");
    const symbol = idMap.get(hex) ?? idMap.get(hex.toUpperCase());
    const token = symbol ? getTokenBySymbol(symbol) : null;
    if (!token) continue;
    out.push({
      symbol: token.symbol,
      shieldedSymbol: token.shieldedSymbol,
      decimals: token.decimals,
      depositCount: entry.depositCount ?? 0,
      withdrawCount: entry.withdrawCount ?? 0,
      totalShielded: BigInt(entry.totalShielded ?? 0),
      totalWithdrawn: BigInt(entry.totalWithdrawn ?? 0),
      deposits: entry.deposits ?? [],
      depositsTruncated: Boolean(entry.depositsTruncated),
    });
  }
  return out;
}

export function useTokenActivity(networkId?: NetworkId, vault?: VaultId) {
  const env = useChainEnvironment();
  const network = networkId ?? env.networkId;

  const { data, error, isLoading } = useSWR<TokenActivity[]>(
    ["token-activity", network, vault ?? "default"],
    () => fetchTokenActivity(network, vault),
    {
      refreshInterval: 60_000,
      dedupingInterval: 30_000,
      revalidateOnFocus: false,
      errorRetryCount: 2,
    },
  );

  return {
    tokens: data ?? null,
    isLoading,
    error: error ? (error instanceof Error ? error.message : "Failed to load activity") : null,
  };
}

/** Activity for one token symbol, or null once loaded and absent from the pool. */
export function useSingleTokenActivity(symbol: string, vault?: VaultId) {
  const { tokens, isLoading, error } = useTokenActivity(undefined, vault);
  return {
    activity: tokens?.find((t) => t.symbol === symbol) ?? null,
    isLoading,
    error,
  };
}
