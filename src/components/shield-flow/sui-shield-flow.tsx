"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Loader2, Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { StealthRecipientInput } from "@/components/ui/stealth-recipient-input";
import { useSuiShield, type SuiShieldToken } from "@/hooks/sui/use-sui-shield";
import { networkForChain } from "@/lib/chain-registry";
import { makeSuiExplorerLinks } from "@/lib/chain-links";
import { getNetworkConfig } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { useUTXOpiaStore } from "@/stores";
import type { StealthMetaAddress } from "@utxopia/sdk";

interface SuiShieldFlowProps {
  /** Connected Sui wallet address (funds the shield + pays gas). */
  walletAddress: string | null;
  className?: string;
}

export function SuiShieldFlow({ walletAddress, className }: SuiShieldFlowProps) {
  const stealthAddress = useUTXOpiaStore((s) => s.stealthAddress);
  const { networkId } = useChainEnvironment();
  const suiNetwork = networkForChain(networkId, "sui");
  const { tokens, loadingTokens, status, error, txDigest, shield, reset } = useSuiShield(walletAddress);

  const [selected, setSelected] = useState<SuiShieldToken | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [resolvedMeta, setResolvedMeta] = useState<StealthMetaAddress | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected && tokens.length > 0) setSelected(tokens[0]);
    if (selected) {
      const refreshed = tokens.find((t) => t.coinType === selected.coinType);
      if (refreshed && refreshed.walletBalance !== selected.walletBalance) setSelected(refreshed);
    }
  }, [tokens, selected]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const decimals = selected?.decimals ?? 9;
  const walletBalanceDisplay = useMemo(() => {
    if (!selected) return "";
    return (Number(selected.walletBalance) / 10 ** decimals).toLocaleString(undefined, {
      maximumFractionDigits: Math.min(decimals, 6),
    });
  }, [selected, decimals]);

  const onMax = useCallback(() => {
    if (!selected) return;
    setAmount((Number(selected.walletBalance) / 10 ** decimals).toString());
  }, [selected, decimals]);

  const handleShield = useCallback(async () => {
    if (!selected || !amount || !resolvedMeta) return;
    setFormError(null);
    const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** decimals));
    if (amountRaw < selected.minDeposit) {
      setFormError(`Below the minimum shield amount for ${selected.symbol}`);
      return;
    }
    if (selected.maxDeposit > 0n && amountRaw > selected.maxDeposit) {
      setFormError(`Above the maximum shield amount for ${selected.symbol}`);
      return;
    }
    await shield(selected, amountRaw);
  }, [selected, amount, resolvedMeta, decimals, shield]);

  if (status === "done" && selected) {
    const explorer = makeSuiExplorerLinks(
      getNetworkConfig(suiNetwork, { applyEnvOverrides: false }).sui?.explorerUrl ?? "",
      suiNetwork,
    );
    return (
      <div className={cn("space-y-4 py-6 text-center", className)}>
        <div className="inline-flex rounded-full border border-sui/20 bg-sui/10 p-3">
          <CheckCircle2 className="h-8 w-8 text-sui" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Funds added privately</h3>
        <p className="text-caption text-gray">Your {selected.symbol} is now in your private balance.</p>
        {txDigest && (
          <a
            href={explorer.tx(txDigest)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-1.5 text-caption text-sui transition-colors hover:text-sui/80"
          >
            View transaction <ExternalLink className="h-3 w-3" />
          </a>
        )}
        <div className="pt-2">
          <button
            onClick={() => {
              reset();
              setAmount("");
            }}
            className="rounded-[10px] border border-gray/15 bg-muted px-5 py-2 text-body2 text-gray-light transition-colors hover:bg-muted/80 hover:text-foreground cursor-pointer"
          >
            Add more funds
          </button>
        </div>
      </div>
    );
  }

  if (loadingTokens && tokens.length === 0) {
    return (
      <div className={cn("flex items-center justify-center gap-2 py-10", className)}>
        <Loader2 className="h-4 w-4 animate-spin text-sui" />
        <span className="text-caption text-gray">Loading supported tokens...</span>
      </div>
    );
  }

  if (tokens.length === 0) {
    return (
      <div className={cn("flex flex-col items-center py-10 text-center", className)}>
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-sui/20 bg-sui/10">
          <Shield className="h-5 w-5 text-sui" />
        </div>
        <p className="text-body2-semibold text-foreground">No tokens registered yet</p>
        <p className="mt-1 max-w-[280px] text-caption text-gray">
          An admin must register a Coin type before it can be shielded on Sui.
        </p>
      </div>
    );
  }

  const shownError = formError || error;
  const canSubmit = !!selected && !!amount && parseFloat(amount) > 0 && !!resolvedMeta && !!walletAddress;

  return (
    <div className={cn("space-y-5", className)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-caption text-gray">Amount</span>
          <span className="text-caption text-gray/50">
            {walletAddress
              ? selected
                ? `Balance: ${walletBalanceDisplay} ${selected.symbol}`
                : ""
              : "Connect a Sui wallet"}
          </span>
        </div>
        <div className="flex items-center gap-2 rounded-[12px] border border-gray/15 bg-muted p-3 transition-colors focus-within:border-sui/30">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="min-w-0 flex-1 bg-transparent font-mono text-lg text-foreground placeholder:text-gray/30 outline-none"
          />
          <button
            onClick={onMax}
            className="rounded-[6px] border border-sui/20 bg-sui/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sui transition-colors hover:bg-sui/20 cursor-pointer"
          >
            Max
          </button>

          {/* Token picker — registered Coin<T> with wallet balances */}
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-[8px] border border-gray/15 bg-background/60 px-2.5 py-1.5 transition-colors hover:border-gray/30 cursor-pointer"
            >
              {selected?.logo && (
                <Image src={selected.logo} alt={selected.symbol} width={20} height={20} className="rounded-full" />
              )}
              <span className="text-sm font-semibold text-foreground">{selected?.symbol ?? "Select"}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-gray transition-transform", dropdownOpen && "rotate-180")} />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-[240px] overflow-hidden rounded-[12px] border border-gray/20 bg-card shadow-xl">
                {tokens.map((token) => (
                  <button
                    key={token.coinType}
                    onClick={() => {
                      setSelected(token);
                      setDropdownOpen(false);
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
                    <div className="font-mono text-[10px] text-gray/50">
                      {(Number(token.walletBalance) / 10 ** token.decimals).toLocaleString(undefined, {
                        maximumFractionDigits: Math.min(token.decimals, 4),
                      })}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <StealthRecipientInput
        onResolved={(meta, name) => {
          setResolvedMeta(meta);
          setResolvedName(name);
        }}
        resolvedMeta={resolvedMeta}
        resolvedName={resolvedName}
        error={formError}
        onError={setFormError}
        label="Private destination"
        selfMeta={stealthAddress ?? null}
        defaultToSelf
      />

      {shownError && status !== "processing" && (
        <div className="flex items-center gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <span className="text-caption text-red-400">{shownError}</span>
        </div>
      )}

      <button
        onClick={handleShield}
        disabled={!canSubmit || status === "processing"}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-[12px] py-3.5 text-body2 font-semibold transition-all cursor-pointer",
          canSubmit && status !== "processing"
            ? "bg-foreground text-background hover:bg-white"
            : "cursor-not-allowed bg-gray/20 text-gray/50",
        )}
      >
        {status === "processing" ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            Adding...
          </>
        ) : (
          <>
            <Shield className="h-4 w-4" />
            Add {selected?.symbol ?? ""} privately
          </>
        )}
      </button>
    </div>
  );
}
