"use client";

/**
 * Shared presentational primitives for the Sui private flows (shield / send /
 * cash out). These flows differ only in their balance source, recipient field,
 * and the hook they call — the token picker, amount field, status panels and
 * submit button are identical, so they live here once.
 */

import { useEffect, useRef, useState, type ReactNode } from "react";
import Image from "next/image";
import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { SuiShieldToken } from "@/hooks/sui/use-sui-shield";

function formatUnits(base: bigint, decimals: number, maxFractionDigits = 6): string {
  return (Number(base) / 10 ** decimals).toLocaleString(undefined, {
    maximumFractionDigits: Math.min(decimals, maxFractionDigits),
  });
}

/** Token dropdown + amount input + Max. The single most-duplicated block. */
export function SuiTokenAmountField({
  tokens,
  selected,
  onSelect,
  amount,
  onAmount,
  balanceLabel,
  maxBaseUnits,
  decimals,
  showTokenBalances = false,
}: {
  tokens: SuiShieldToken[];
  selected: SuiShieldToken | null;
  onSelect: (token: SuiShieldToken) => void;
  amount: string;
  onAmount: (value: string) => void;
  /** Right-aligned caption above the field, e.g. `Private: 1.2 SUI`. */
  balanceLabel: string;
  /** Base units the Max button fills in. */
  maxBaseUnits: bigint;
  decimals: number;
  /** Show per-token balances inside the dropdown (shield uses wallet balances). */
  showTokenBalances?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-caption text-gray">Amount</span>
        <span className="text-caption text-gray/50">{balanceLabel}</span>
      </div>
      <div className="flex items-center gap-2 rounded-[12px] border border-gray/15 bg-muted p-3 transition-colors focus-within:border-sui/30">
        <input
          type="number"
          value={amount}
          onChange={(e) => onAmount(e.target.value)}
          placeholder="0.00"
          className="min-w-0 flex-1 bg-transparent font-mono text-lg text-foreground placeholder:text-gray/30 outline-none"
        />
        <button
          onClick={() => onAmount(String(Number(maxBaseUnits) / 10 ** decimals))}
          className="rounded-[6px] border border-sui/20 bg-sui/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sui transition-colors hover:bg-sui/20 cursor-pointer"
        >
          Max
        </button>
        <div className="relative" ref={ref}>
          <button
            onClick={() => setOpen((o) => !o)}
            className="flex items-center gap-1.5 rounded-[8px] border border-gray/15 bg-background/60 px-2.5 py-1.5 transition-colors hover:border-gray/30 cursor-pointer"
          >
            {selected?.logo && (
              <Image src={selected.logo} alt={selected.symbol} width={20} height={20} className="rounded-full" />
            )}
            <span className="text-sm font-semibold text-foreground">{selected?.symbol ?? "Select"}</span>
            <ChevronDown className={cn("h-3.5 w-3.5 text-gray transition-transform", open && "rotate-180")} />
          </button>
          {open && (
            <div className="absolute right-0 top-full z-50 mt-1 w-[240px] overflow-hidden rounded-[12px] border border-gray/20 bg-card shadow-xl">
              {tokens.map((token) => (
                <button
                  key={token.coinType}
                  onClick={() => {
                    onSelect(token);
                    setOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2.5 px-3 py-2.5 transition-colors hover:bg-muted/50 cursor-pointer",
                    selected?.coinType === token.coinType && "bg-sui/5",
                  )}
                >
                  {token.logo && (
                    <Image src={token.logo} alt={token.symbol} width={20} height={20} className="rounded-full" />
                  )}
                  <div className="flex-1 text-left">
                    <div className="text-sm font-medium text-foreground">{token.symbol}</div>
                    <div className="text-[10px] text-gray">{token.name}</div>
                  </div>
                  {showTokenBalances && (
                    <div className="font-mono text-[10px] text-gray/50">
                      {formatUnits(token.walletBalance, token.decimals, 4)}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** Terminal success panel with an explorer link and a reset action. */
export function SuiFlowSuccess({
  title,
  subtitle,
  txHref,
  resetLabel,
  onReset,
  className,
}: {
  title: string;
  subtitle: string;
  txHref?: string | null;
  resetLabel: string;
  onReset: () => void;
  className?: string;
}) {
  return (
    <div className={cn("space-y-4 py-6 text-center", className)}>
      <div className="inline-flex rounded-full border border-sui/20 bg-sui/10 p-3">
        <CheckCircle2 className="h-8 w-8 text-sui" />
      </div>
      <h3 className="text-lg font-semibold text-foreground">{title}</h3>
      <p className="text-caption text-gray">{subtitle}</p>
      {txHref && (
        <a
          href={txHref}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-caption text-sui transition-colors hover:text-sui/80"
        >
          View transaction <ExternalLink className="h-3 w-3" />
        </a>
      )}
      <div className="pt-2">
        <button
          onClick={onReset}
          className="rounded-[10px] border border-gray/15 bg-muted px-5 py-2 text-body2 text-gray-light transition-colors hover:bg-muted/80 hover:text-foreground cursor-pointer"
        >
          {resetLabel}
        </button>
      </div>
    </div>
  );
}

export function SuiFlowError({ message }: { message: string }) {
  return (
    <div className="flex items-center gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-3">
      <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
      <span className="text-caption text-red-400">{message}</span>
    </div>
  );
}

export function SuiTokensLoading({ className }: { className?: string }) {
  return (
    <div className={cn("flex items-center justify-center gap-2 py-10", className)}>
      <Loader2 className="h-4 w-4 animate-spin text-sui" />
      <span className="text-caption text-gray">Loading supported tokens...</span>
    </div>
  );
}

export function SuiTokensEmpty({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("py-8 text-center", className)}>{children}</div>;
}

/** Primary submit button with the shared proving/spinner treatment. */
export function SuiSubmitButton({
  busy,
  canSubmit,
  busyLabel,
  idleLabel,
  idleIcon,
  provingElapsed,
  onClick,
}: {
  busy: boolean;
  canSubmit: boolean;
  busyLabel: string;
  idleLabel: string;
  idleIcon: ReactNode;
  /** Seconds elapsed while proving; the counter shows once it passes 3s. */
  provingElapsed?: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      disabled={!canSubmit || busy}
      className={cn(
        "flex w-full items-center justify-center gap-2 rounded-[12px] py-3.5 text-body2 font-semibold transition-all cursor-pointer",
        canSubmit && !busy ? "bg-foreground text-background hover:bg-white" : "cursor-not-allowed bg-gray/20 text-gray/50",
      )}
    >
      {busy ? (
        <>
          <Loader2 className="h-4 w-4 animate-spin" />
          {busyLabel}
          {provingElapsed != null && provingElapsed >= 3 && (
            <span className="tabular-nums opacity-70">{provingElapsed}s</span>
          )}
        </>
      ) : (
        <>
          {idleIcon}
          {idleLabel}
        </>
      )}
    </button>
  );
}
