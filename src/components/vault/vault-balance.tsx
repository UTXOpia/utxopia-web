"use client";

import { useEffect, useRef, useState } from "react";
import { motion } from "framer-motion";
import { RefreshCw, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { VAULT_TOKENS } from "@/lib/supported-tokens";
import type { TokenPrices } from "@/hooks/use-token-prices";
import type { VaultId } from "@/lib/vault-config";
import type { SiblingVaultBalances } from "@/hooks/use-sibling-vault-balances";

interface VaultBalanceProps {
  balancesByToken: Record<string, bigint>;
  /** First scan of this identity — nothing to show yet. Skeleton only here. */
  isLoading: boolean;
  /** A scan is in flight over numbers that are already on screen. */
  isRefreshing?: boolean;
  tokenPrices: TokenPrices;
  onRefresh: () => void;
  vaultId: VaultId;
  sibling?: SiblingVaultBalances;
}

const COUNT_MS = 550;
const SPLIT_LINE_CLASS =
  "mt-1.5 text-[11px] text-gray/45 font-mono flex items-center justify-center gap-1";

/** Tween a number toward its new value. Skips the first assignment (a count-up
 *  from zero on every page load is noise) and snaps moves too small to see.
 *  `epsilon` is in the units of `value` — a cent for USD, a satoshi's worth of
 *  BTC for the BTC line, which is eight decimal places down and would otherwise
 *  never clear a USD-sized threshold. */
function useCountUp(value: number, enabled: boolean, epsilon: number): number {
  const [display, setDisplay] = useState(value);
  const current = useRef(value);
  const primed = useRef(false);

  useEffect(() => {
    if (!enabled || !primed.current) {
      primed.current = enabled;
      current.current = value;
      setDisplay(value);
      return;
    }
    const from = current.current;
    const delta = value - from;
    if (Math.abs(delta) < epsilon) {
      current.current = value;
      setDisplay(value);
      return;
    }
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      current.current = value;
      setDisplay(value);
      return;
    }

    let frame = 0;
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / COUNT_MS);
      const eased = 1 - (1 - t) ** 3;
      current.current = from + delta * eased;
      setDisplay(current.current);
      if (t < 1) frame = requestAnimationFrame(step);
      else current.current = value;
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [value, enabled, epsilon]);

  return display;
}

export function VaultBalance({
  balancesByToken,
  isLoading,
  isRefreshing = false,
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
  const rawTotalUsd = activeUsd + siblingUsd;

  const pending = isLoading || isRefreshing;

  // Gate on native funds, not USD — a dead price feed must not hide the split.
  const verifiedNative = Object.values(
    (vaultId === "verified" ? balancesByToken : siblingReady ? sibling.balancesByToken : {}) ?? {},
  ).some((amount) => amount > 0n);
  const openNow = vaultId === "open" ? activeUsd : siblingUsd;
  const verifiedNow = vaultId === "verified" ? activeUsd : siblingUsd;

  // The hero is Open + Verified, so a vault switch does not change it — but the
  // two halves reload at different moments, and the total would dip toward zero
  // and climb back while they do. Hold the last settled figures across a refresh
  // rather than animating through a number that was never true, and keep the
  // split line rendered so the card does not change height mid-switch.
  const [settled, setSettled] = useState({ total: rawTotalUsd, show: false, open: 0, verified: 0 });
  useEffect(() => {
    if (pending || !siblingReady) return;
    setSettled({ total: rawTotalUsd, show: verifiedNative, open: openNow, verified: verifiedNow });
  }, [pending, siblingReady, rawTotalUsd, verifiedNative, openNow, verifiedNow]);

  const totalUsd = pending && rawTotalUsd === 0 ? settled.total : rawTotalUsd;
  const btcPrice = tokenPrices.btc || 0;
  const btcEquivalent = btcPrice > 0 ? totalUsd / btcPrice : 0;
  const showSplit = siblingReady && !pending ? verifiedNative : settled.show;
  const openUsd = siblingReady && !pending ? openNow : settled.open;
  const verifiedUsd = siblingReady && !pending ? verifiedNow : settled.verified;
  const pricesLive = totalUsd > 0;

  const animatedUsd = useCountUp(totalUsd, !isLoading, 0.01);
  const animatedBtc = useCountUp(btcEquivalent, !isLoading, 1e-8);

  const usd = (v: number) =>
    v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return (
    <div className="text-center py-6 mb-2" aria-busy={pending}>
      {isLoading ? (
        <div className="animate-pulse">
          <div className="mx-auto mb-2 h-[36px] w-[190px] rounded-[10px] bg-gray/10 sm:h-[42px] sm:w-[220px]" />
          <div className="mx-auto h-3 w-[120px] rounded-full bg-gray/8" />
        </div>
      ) : (
        // Mounts once, when the first scan lands, so the skeleton dissolves into
        // the figure instead of being replaced between two frames. Deliberately
        // un-keyed: re-mounting on value change is what made every cent of price
        // drift flash the whole balance.
        <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 0.25 }}>
          <p
            className={cn(
              "text-[36px] sm:text-[42px] font-bold text-foreground tracking-tight leading-none mb-1",
              "tabular-nums",
            )}
          >
            ${usd(animatedUsd)}
          </p>
          <p className="text-body2 text-gray/60 font-mono flex items-center justify-center gap-1.5 tabular-nums">
            {animatedBtc.toFixed(8)} BTC
            <button
              onClick={onRefresh}
              disabled={pending}
              className="p-0.5 rounded text-gray/30 hover:text-privacy transition-colors disabled:opacity-50 cursor-pointer"
              title="Refresh"
            >
              <RefreshCw className={cn("w-3 h-3", pending && "animate-spin")} />
            </button>
          </p>
          {showSplit ? (
            <p className={SPLIT_LINE_CLASS}>
              {pricesLive ? `Open $${usd(openUsd)}` : "Open"}
              <span className="text-gray/30">·</span>
              <ShieldCheck className="w-3 h-3 text-privacy/70" />
              <span className="text-privacy/70">
                {pricesLive ? `Verified $${usd(verifiedUsd)}` : "Verified"}
              </span>
            </p>
          ) : sibling?.status === "loading" ? (
            // The sibling vault is still being read and may yet produce this
            // row. Hold its height rather than letting the card — and
            // everything under it — grow a line once the answer arrives. Same
            // markup, just invisible, so the reservation cannot drift from the
            // real thing.
            <p className={cn(SPLIT_LINE_CLASS, "invisible")} aria-hidden>
              Open · Verified
            </p>
          ) : null}
        </motion.div>
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
