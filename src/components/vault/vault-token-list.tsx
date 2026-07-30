"use client";

import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ChevronDown,
  ChevronRight,
  Loader2,
  PlusCircle,
  ShieldCheck,
  Unlock,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { VAULT_TOKENS } from "@/lib/supported-tokens";
import { hrefWithChain, type NetworkId } from "@/lib/network-config";
import { hrefWithVault, siblingVaultId, vaultsSupported, type VaultId } from "@/lib/vault-config";
import type { TokenPrices } from "@/hooks/use-token-prices";
import type { SiblingVaultBalances } from "@/hooks/use-sibling-vault-balances";

interface VaultTokenListProps {
  balancesByToken: Record<string, bigint>;
  depositCount: number;
  isLoading: boolean;
  networkId: NetworkId;
  vaultId: VaultId;
  tokenPrices: TokenPrices;
  sibling?: SiblingVaultBalances;
  /** BTC deposits broadcast but not yet spendable. */
  pendingCount?: number;
}

const VAULT_META: Record<VaultId, { label: string; icon: typeof Unlock }> = {
  open: { label: "Open", icon: Unlock },
  verified: { label: "Verified", icon: ShieldCheck },
};

export function VaultTokenList({
  balancesByToken,
  depositCount,
  isLoading,
  networkId,
  vaultId,
  tokenPrices,
  sibling,
  pendingCount = 0,
}: VaultTokenListProps) {
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const siblingReady = sibling?.status === "ready";
  const siblingVault = siblingVaultId(vaultId);
  const dualVault = vaultsSupported(networkId);

  const totalFor = (symbol: string): bigint =>
    (balancesByToken?.[symbol] ?? 0n) +
    (siblingReady ? sibling.balancesByToken[symbol] ?? 0n : 0n);

  const hasAnyBalance = VAULT_TOKENS.some((token) => totalFor(token.shieldedSymbol) > 0n);

  const sortedTokens = [...VAULT_TOKENS].sort((a, b) => {
    const aRaw = Number(totalFor(a.shieldedSymbol));
    const bRaw = Number(totalFor(b.shieldedSymbol));
    if (aRaw > 0 && bRaw === 0) return -1;
    if (aRaw === 0 && bRaw > 0) return 1;
    const aUsd = (aRaw / 10 ** a.decimals) * (tokenPrices[a.priceKey] || 0);
    const bUsd = (bRaw / 10 ** b.decimals) * (tokenPrices[b.priceKey] || 0);
    return bUsd - aUsd;
  });

  const toggleExpanded = (symbol: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(symbol)) next.delete(symbol);
      else next.add(symbol);
      return next;
    });
  };

  const formatAmount = (raw: bigint, decimals: number): string => {
    const maxDec = Math.min(decimals, 6);
    return (Number(raw) / 10 ** decimals).toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: maxDec,
    });
  };

  return (
    <div className="mb-5">
      <div className="flex items-center justify-between px-1 mb-2">
        <span className="text-[11px] text-gray/50 uppercase tracking-wider font-medium">Tokens</span>
        {/* One slot, two states: in-flight deposits take priority over the
            plain link, since both lead to the same place. */}
        {pendingCount > 0 ? (
          <Link
            href={hrefWithChain("/vault/activity", networkId)}
            className="flex items-center gap-1 text-[11px] text-privacy/80 hover:text-privacy transition-colors cursor-pointer"
          >
            <Loader2 className="w-3 h-3 animate-spin" />
            {pendingCount} arriving
            <ChevronRight className="w-3 h-3" />
          </Link>
        ) : depositCount > 0 ? (
          <Link
            href={hrefWithChain("/vault/activity?tab=notes", networkId)}
            className="flex items-center gap-0.5 text-[11px] text-privacy/60 hover:text-privacy transition-colors cursor-pointer"
          >
            View activity
            <ChevronRight className="w-3 h-3" />
          </Link>
        ) : null}
      </div>

      <div className="rounded-[14px] border border-gray/10 overflow-hidden divide-y divide-gray/8">
        {!hasAnyBalance && !isLoading ? (
          <VaultTokenEmptyState networkId={networkId} />
        ) : (
          sortedTokens.map((token) => {
            const symbol = token.shieldedSymbol;
            const activeRaw = balancesByToken?.[symbol] ?? 0n;
            const siblingRaw = siblingReady ? sibling.balancesByToken[symbol] ?? 0n : 0n;
            const totalRaw = activeRaw + siblingRaw;
            const hasBalance = totalRaw > 0n;
            const price = tokenPrices[token.priceKey];
            const usdValue = price ? (Number(totalRaw) / 10 ** token.decimals) * price : 0;
            const openRaw = vaultId === "open" ? activeRaw : siblingRaw;
            const verifiedRaw = vaultId === "verified" ? activeRaw : siblingRaw;
            // Vaults are separate pools, so a balance always needs an owner.
            // Expandable whenever there is something to attribute — with the
            // sibling locked the panel says so rather than hiding the split.
            const expandable = dualVault && hasBalance;
            const isExpanded = expandable && expanded.has(symbol);
            // Tag the row when every unit sits in one pool. Split balances get
            // no tag: the chevron is the honest answer there.
            const soleVault: VaultId | null =
              siblingReady && hasBalance
                ? verifiedRaw === 0n
                  ? "open"
                  : openRaw === 0n
                    ? "verified"
                    : null
                : null;

            return (
              <div key={token.symbol}>
                <div
                  role={expandable ? "button" : undefined}
                  tabIndex={expandable ? 0 : undefined}
                  onClick={expandable ? () => toggleExpanded(symbol) : undefined}
                  onKeyDown={
                    expandable
                      ? (e) => {
                          if (e.key === "Enter" || e.key === " ") {
                            e.preventDefault();
                            toggleExpanded(symbol);
                          }
                        }
                      : undefined
                  }
                  className={cn(
                    "flex items-center gap-3 px-4 h-[60px] transition-colors",
                    hasBalance ? "hover:bg-muted/40" : "opacity-40",
                    expandable && "cursor-pointer",
                  )}
                >
                  <Image src={token.shieldedLogo} alt={symbol} width={36} height={36} className="rounded-full" />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-1.5">
                      <p className="text-body2-semibold text-foreground">{symbol}</p>
                      {soleVault && <VaultRowTag vault={soleVault} />}
                    </div>
                    <p className="text-[11px] text-gray/50">{token.name}</p>
                  </div>
                  <div className="text-right">
                    {isLoading ? (
                      <Loader2 className="w-4 h-4 animate-spin text-privacy ml-auto" />
                    ) : hasBalance ? (
                      <>
                        <p className="text-body2-semibold text-foreground font-mono">
                          {formatAmount(totalRaw, token.decimals)}
                        </p>
                        <p className="text-[11px] text-gray/45 font-mono">
                          ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                        </p>
                      </>
                    ) : (
                      <p className="text-body2 text-gray/30 font-mono">0.00</p>
                    )}
                  </div>
                  {expandable && (
                    <ChevronDown
                      className={cn(
                        "w-3.5 h-3.5 text-gray/40 transition-transform",
                        isExpanded && "rotate-180",
                      )}
                    />
                  )}
                </div>

                {isExpanded && (
                  <div
                    className="bg-muted/20 divide-y divide-gray/6"
                    title="Open and Verified funds live in separate privacy pools and can't be transferred directly."
                  >
                    {([
                      { vault: "open", raw: openRaw },
                      { vault: "verified", raw: verifiedRaw },
                    ] as const).map(({ vault, raw }) => {
                      const meta = VAULT_META[vault];
                      const MetaIcon = meta.icon;
                      const known = siblingReady || vault === vaultId;
                      return (
                        <div key={vault} className="flex items-center gap-2 pl-[52px] pr-4 h-[40px]">
                          <MetaIcon
                            className={cn(
                              "w-3.5 h-3.5",
                              vault === "verified" ? "text-privacy" : "text-gray/50",
                            )}
                          />
                          <span className="flex-1 text-[12px] text-gray-light/80">{meta.label}</span>
                          <span
                            className={cn(
                              "text-[12px] font-mono",
                              known ? "text-foreground/90" : "text-gray/40",
                            )}
                          >
                            {known ? formatAmount(raw, token.decimals) : "Locked"}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {sibling?.status === "locked" && (
        <p className="px-1 mt-1.5 text-[11px] text-gray/40">
          {VAULT_META[siblingVault].label} vault balance is locked —{" "}
          <Link
            href={hrefWithVault(hrefWithChain("/vault", networkId), siblingVault)}
            className="text-privacy/60 hover:text-privacy transition-colors"
          >
            switch to unlock
          </Link>
        </p>
      )}
    </div>
  );
}

/** Pool attribution for a balance that sits entirely in one pool. */
function VaultRowTag({ vault }: { vault: VaultId }) {
  const meta = VAULT_META[vault];
  const Icon = meta.icon;
  const verified = vault === "verified";
  return (
    <span
      title={`All of this balance is in the ${meta.label} pool`}
      className={cn(
        "inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-[10px]",
        verified ? "bg-privacy/10 text-privacy" : "bg-gray/10 text-gray/60",
      )}
    >
      <Icon className="w-3 h-3" />
      {meta.label}
    </span>
  );
}

function VaultTokenEmptyState({ networkId }: { networkId: NetworkId }) {
  return (
    <div className="flex flex-col items-center py-8 px-4">
      <div className="w-12 h-12 rounded-full bg-privacy/10 border border-privacy/20 flex items-center justify-center mb-3">
        <PlusCircle className="w-5 h-5 text-privacy" />
      </div>
      <p className="text-sm font-medium text-foreground mb-1">Ready to go private?</p>
      <p className="text-xs text-gray/50 text-center mb-4">
        Add BTC or a supported chain token to start.
      </p>
      <Link
        href={hrefWithChain("/vault/deposit", networkId)}
        className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-foreground hover:bg-white text-background text-sm font-medium transition-all duration-200 cursor-pointer active:scale-[0.98]"
      >
        Add your first funds
        <ArrowRight className="w-3.5 h-3.5" />
      </Link>
    </div>
  );
}
