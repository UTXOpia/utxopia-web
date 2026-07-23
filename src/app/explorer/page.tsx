"use client";

import { useState, useMemo, useCallback, useEffect, Suspense, Fragment } from "react";
import {
  ArrowDownToLine,
  ArrowUpDown,
  ArrowUpFromLine,
  Loader2,
  Shield,
} from "lucide-react";
import useSWR from "swr";
import { useExplorer } from "@/hooks/use-explorer";
import type { ExplorerTransaction, RedemptionRecord } from "@/hooks/use-explorer";
import { usePoolStats } from "@/hooks/use-pool-stats";
import { useTokenPrices } from "@/hooks/use-token-prices";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { cn } from "@/lib/utils";
import { detectNetwork, NETWORK_META, type NetworkId } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";

import { TypeFilterBar, LoadingState, StatCard, Th, RefreshButton, EmptyState } from "./components/shared";
import type { FilterType, TokenFilter } from "./components/shared";
import { TransferRow, getTransferKind } from "./components/transfers-tab";
import { getTokenByFilter, formatTokenAmount, tvlToUsd, type TokenFilterId } from "@/lib/supported-tokens";

// =============================================================================
// Sync status: shows when backend indexer is catching up
// =============================================================================

function useSyncStatus(network: NetworkId) {
  const { data } = useSWR<{ synced: boolean }>(
    ["tree-sync-status", network],
    async () => {
      const resp = await fetch(`/api/tree/status?network=${encodeURIComponent(network)}`);
      if (!resp.ok) return { synced: true };
      const json = await resp.json();
      return { synced: json.synced ?? true };
    },
    { refreshInterval: 15_000, revalidateOnFocus: false },
  );
  return data?.synced ?? true;
}

// =============================================================================
// Explorer Content
// =============================================================================

function ExplorerContent({ network }: { network: NetworkId }) {
  const [activeFilter, setActiveFilter] = useState<FilterType>("all");
  const [selectedTokens, setSelectedTokens] = useState<Set<TokenFilter>>(() => new Set(["btc", "sol", "usdc", "usdt"] as TokenFilter[]));
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const { transactions: allTransactions, refresh: refreshAll } = useExplorer(network);
  const { data: redemptions = [] } = useSWR<RedemptionRecord[]>(
    ["explorer-redemptions", network],
    async () => {
      const resp = await fetch(`/api/explorer/redemptions?network=${encodeURIComponent(network)}`);
      if (!resp.ok) return [];
      const json = await resp.json();
      return json.redemptions ?? [];
    },
    { refreshInterval: 30_000, dedupingInterval: 5_000, revalidateOnFocus: false },
  );
  const redemptionByRequestTx = useMemo(
    () => new Map(
      redemptions
        .filter((redemption) => redemption.requestTxSignature)
        .map((redemption) => [redemption.requestTxSignature!, redemption]),
    ),
    [redemptions],
  );

  const toggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);


  // All transactions come from useExplorer(), already sorted by timestamp desc.

  // Counts by type (withdraw counts as unshield)
  const counts = useMemo(() => {
    const c: Record<FilterType, number> = { all: 0, shield: 0, transfer: 0, unshield: 0 };
    for (const tx of allTransactions) {
      if (tx.type === "shield") c.shield++;
      else if (tx.type === "transfer") c.transfer++;
      else c.unshield++; // unshield + withdraw
    }
    c.all = allTransactions.length;
    return c;
  }, [allTransactions]);

  // Map token symbol to filter ID
  function getTokenFilter(tx: ExplorerTransaction): TokenFilterId {
    const sym = tx.tokenSymbol?.toUpperCase();
    if (sym === "SOL") return "sol";
    if (sym === "USDC") return "usdc";
    if (sym === "USDT") return "usdt";
    return "btc";
  }

  // Filter by type AND token
  const filtered = useMemo(() => {
    let items = allTransactions;

    // Type filter
    if (activeFilter !== "all") {
      if (activeFilter === "unshield") {
        items = items.filter((t) => t.type === "unshield" || t.type === "withdraw");
      } else {
        items = items.filter((t) => t.type === activeFilter);
      }
    }

    // Token filter only applies to shield and unshield. Transfers are token-agnostic.
    if (selectedTokens.size < 4) {
      items = items.filter((t) => {
        if (t.type === "transfer") return true;
        return selectedTokens.has(getTokenFilter(t));
      });
    }

    return items;
  }, [allTransactions, activeFilter, selectedTokens]);

  // TVL from on-chain pool state (same as main page)
  const { stats } = usePoolStats(network);
  const prices = useTokenPrices();

  const totalShieldedDisplay = useMemo(() => {
    if (!stats?.tokenTVL?.length) return "No TVL";
    const total = tvlToUsd(stats.tokenTVL, prices);
    if (total === 0) return "No TVL";
    return `$${total.toLocaleString(undefined, { maximumFractionDigits: 2 })}`;
  }, [stats, prices]);

  return (
    <>
      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
        <StatCard label="Deposits" value={counts.shield} color="bg-muted/30 border-gray/15" />
        <StatCard label="Private transfers" value={counts.transfer} color="bg-muted/30 border-gray/15" />
        <StatCard label="Cash-outs" value={counts.unshield} color="bg-muted/30 border-gray/15" />
        <StatCard label="Private value" value={totalShieldedDisplay} color="bg-muted/30 border-gray/15" />
      </div>

      {/* Filter Bar */}
      <div className="flex items-center justify-between mb-4">
        <TypeFilterBar
          activeFilter={activeFilter}
          onFilterChange={setActiveFilter}
          selectedTokens={selectedTokens}
          onToggleToken={(t) => {
            setSelectedTokens((prev) => {
              const next = new Set(prev);
              if (next.has(t)) {
                if (next.size > 1) next.delete(t);
              } else {
                next.add(t);
              }
              return next;
            });
          }}
          counts={counts}
        />
        <RefreshButton onClick={refreshAll} />
      </div>

      {/* Unified Table */}
      <div className="min-h-[40vh]">
        {filtered.length === 0 ? (
          <EmptyState label="transactions" />
        ) : (
          <div className="overflow-x-auto rounded-[12px] border border-gray/15 backdrop-blur-sm bg-muted/30">
            <table className="w-full min-w-[750px]">
              <thead>
                <tr className="border-b border-gray/15 bg-muted/50">
                  <Th>Status</Th>
                  <Th>Tx ID</Th>
                  <Th>Type</Th>
                  <Th>Flow</Th>
                  <Th>Amount</Th>
                  <Th>Time</Th>
                  <Th className="w-[40px]" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray/10">
                {filtered.map((tx) => {
                  const rowKey = tx.txSignature || tx.btcMeta?.depositTxid || `${tx.type}-${tx.timestamp}`;
                  return (
                    <TransferRow
                      key={`${tx.type}-${rowKey}`}
                      tx={tx}
                      network={network}
                      expanded={expanded.has(rowKey)}
                      onToggle={() => toggle(rowKey)}
                      redemption={redemptionByRequestTx.get(tx.txSignature)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// =============================================================================
// Main Page
// =============================================================================

function ExplorerBody({ network }: { network: NetworkId }) {
  const synced = useSyncStatus(network);
  const tone = useMemo(() => getExplorerTone(network), [network]);

  return (
    <main className="min-h-screen bg-background overflow-x-hidden flex flex-col">
      <SiteHeader />
      <div className="container mx-auto px-4 pt-24 pb-8 relative z-10 max-w-7xl flex-1 flex flex-col">
        {/* Title */}
        <div className="mb-8">
          <div className="flex items-center gap-3 mb-3">
            <div className={cn("h-px w-8 bg-gradient-to-r to-transparent", tone.rule)} />
            <span className={cn("text-[11px] font-mono uppercase tracking-[0.2em]", tone.eyebrow)}>On-Chain Data</span>
          </div>
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
            <div>
              <h1 className="text-3xl md:text-4xl font-semibold tracking-tight text-foreground mb-1.5">Explorer</h1>
              <p className="text-sm text-gray font-light">Inspect public protocol records without revealing private transaction details.</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className={cn("flex items-center gap-1.5 px-2.5 py-1 rounded-full border", tone.poolPill)}>
                <Shield className={cn("w-3 h-3", tone.icon)} />
                <span className={cn("text-[10px] font-mono", tone.mutedText)}>Private vault protocol</span>
              </div>
              <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-muted/30 border border-gray/10">
                <span className={cn("w-1.5 h-1.5 rounded-full animate-pulse", tone.dot)} />
                <span className="text-[10px] font-mono text-gray/50">{tone.networkLabel}</span>
              </div>
              {!synced && (
                <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/5 border border-orange-500/15">
                  <Loader2 className="w-3 h-3 text-orange-400 animate-spin" />
                  <span className="text-[10px] font-mono text-orange-400/70">Syncing…</span>
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          <Suspense fallback={<LoadingState />}>
            <ExplorerContent network={network} />
          </Suspense>
        </div>

        {/* Privacy Note */}
        <div className={cn("mt-6 p-3 glass-card rounded-[16px]", tone.noteBorder)}>
          <div className="flex items-center gap-2 mb-1">
            <Shield className={cn("w-4 h-4", tone.icon)} />
            <span className={cn("text-caption", tone.text)}>Privacy Preserved</span>
          </div>
          <p className="text-caption text-gray">
            Transfer amounts are encrypted with zero-knowledge proofs. Only commitments and
            nullifiers are visible on-chain. Amounts and sender/recipient information are not exposed.
          </p>
        </div>

      </div>
      <SiteFooter />
    </main>
  );
}

export default function ExplorerPage() {
  const { networkId: network } = useChainEnvironment();
  const [clientReady, setClientReady] = useState(false);
  const currentBrowserNetwork = typeof window === "undefined" ? network : detectNetwork();
  const networkReady = clientReady && network === currentBrowserNetwork;

  useEffect(() => {
    setClientReady(true);
  }, []);

  if (!networkReady) {
    return (
      <main className="min-h-screen bg-background overflow-x-hidden flex flex-col">
        <SiteHeader />
        <div className="container mx-auto px-4 pt-24 pb-8 relative z-10 max-w-7xl flex-1">
          <LoadingState />
        </div>
        <SiteFooter />
      </main>
    );
  }

  return <ExplorerBody network={network} />;
}

function getExplorerTone(network: NetworkId) {
  const networkLabel = NETWORK_META.find((item) => item.id === network)?.label ?? network;
  return {
    networkLabel,
    rule: "from-privacy/50",
    eyebrow: "text-privacy/60",
    poolPill: "bg-privacy/5 border-privacy/15",
    icon: "text-privacy",
    mutedText: "text-privacy/70",
    text: "text-privacy",
    noteBorder: "border-privacy/15",
    dot: "bg-chain",
  };
}
