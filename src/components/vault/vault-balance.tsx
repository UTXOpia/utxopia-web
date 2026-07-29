"use client";

import { motion } from "framer-motion";
import { Loader2, RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { VAULT_TOKENS } from "@/lib/supported-tokens";
import type { TokenPrices } from "@/hooks/use-token-prices";
import type { VaultId } from "@/lib/vault-config";
import type { SiblingVaultBalances } from "@/hooks/use-sibling-vault-balances";

interface VaultBalanceProps {
  balancesByToken: Record<string, bigint>;
  isLoading: boolean;
  tokenPrices: TokenPrices;
  onRefresh: () => void;
  vaultId: VaultId;
  sibling?: SiblingVaultBalances;
}

export function VaultBalance({
  balancesByToken,
  isLoading,
  tokenPrices,
  onRefresh,
  vaultId,
  sibling,
}: VaultBalanceProps) {
  const activeUsd = getVaultUsdValue(balancesByToken, tokenPrices);
  const siblingReady = sibling?.status === "ready";
  const siblingUsd = siblingReady
    ? getVaultUsdValue(sibling.balancesByToken, tokenPrices)
    : 0;
  const totalUsd = activeUsd + siblingUsd;
  const btcPrice = tokenPrices.btc || 0;
  const btcEquivalent = btcPrice > 0 ? totalUsd / btcPrice : 0;

  const openUsd = vaultId === "open" ? activeUsd : siblingUsd;
  const verifiedUsd = vaultId === "verified" ? activeUsd : siblingUsd;
  // Gate on native funds, not USD — a dead price feed must not hide the split.
  const verifiedNative = Object.values(
    (vaultId === "verified" ? balancesByToken : siblingReady ? sibling.balancesByToken : {}) ?? {},
  ).some((amount) => amount > 0n);
  const showSplit = siblingReady && verifiedNative;
  const pricesLive = totalUsd > 0;

  const usd = (v: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="text-center py-6 mb-2">
      {isLoading ? (
        <Loader2 className="w-6 h-6 animate-spin text-privacy mx-auto mb-2" />
      ) : (
        <>
          <motion.p
            className="text-[36px] sm:text-[42px] font-bold text-foreground tracking-tight leading-none mb-1"
            key={totalUsd.toFixed(2)}
            initial={{ opacity: 0.6, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
          >
            ${usd(totalUsd)}
          </motion.p>
          <p className="text-body2 text-gray/60 font-mono flex items-center justify-center gap-1.5">
            {btcEquivalent.toFixed(8)} BTC
            <button
              onClick={onRefresh}
              disabled={isLoading}
              className="p-0.5 rounded text-gray/30 hover:text-privacy transition-colors disabled:opacity-50 cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={cn("w-3 h-3", isLoading && "animate-spin")} />
            </button>
          </p>
          {showSplit && (
            <p className="mt-1.5 text-[11px] text-gray/45 font-mono flex items-center justify-center gap-1">
              {pricesLive ? `Open $${usd(openUsd)}` : "Open"}
              <span className="text-gray/30">·</span>
              <ShieldCheck className="w-3 h-3 text-privacy/70" />
              <span className="text-privacy/70">
                {pricesLive ? `Verified $${usd(verifiedUsd)}` : "Verified"}
              </span>
            </p>
          )}
        </>
      )}
    </div>
  );
}

function getVaultUsdValue(
  balancesByToken: Record<string, bigint>,
  tokenPrices: TokenPrices,
): number {
  return VAULT_TOKENS.reduce((total, token) => {
    const rawBalance = Number(balancesByToken?.[token.shieldedSymbol] ?? 0n);
    const price = tokenPrices[token.priceKey];
    if (!price) return total;
    return total + (rawBalance / 10 ** token.decimals) * price;
  }, 0);
}
