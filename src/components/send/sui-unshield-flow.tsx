"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { AlertCircle, CheckCircle2, ChevronDown, ExternalLink, Loader2, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSuiShield, type SuiShieldToken } from "@/hooks/sui/use-sui-shield";
import { useSuiUnshield } from "@/hooks/sui/use-sui-unshield";
import { useUTXOpiaStore } from "@/stores";
import { networkForChain } from "@/lib/chain-registry";
import { makeSuiExplorerLinks } from "@/lib/chain-links";
import { getNetworkConfig } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import type { InboxNote } from "@/hooks/use-utxopia";

interface SuiUnshieldFlowProps {
  className?: string;
}

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;

/** Greedy smallest-cover note selection over a coin's unspent notes. */
function selectNotes(notes: InboxNote[], target: bigint): InboxNote[] {
  const sorted = [...notes].sort((a, b) => (a.amount > b.amount ? 1 : a.amount < b.amount ? -1 : 0));
  const out: InboxNote[] = [];
  let total = 0n;
  for (const note of sorted) {
    out.push(note);
    total += note.amount;
    if (total >= target) break;
  }
  return out;
}

export function SuiUnshieldFlow({ className }: SuiUnshieldFlowProps) {
  const { networkId } = useChainEnvironment();
  const suiNetwork = networkForChain(networkId, "sui");
  const keys = useUTXOpiaStore((s) => s.keys);
  const selfMeta = useUTXOpiaStore((s) => s.stealthAddress);
  const inboxNotes = useUTXOpiaStore((s) => s.inboxNotes);

  // Reuse the shield hook only for the registered-token list (symbol → coinType).
  const { tokens, loadingTokens } = useSuiShield(null);
  const { status, statusMessage, txDigest, error, submit, reset } = useSuiUnshield();

  const [selected, setSelected] = useState<SuiShieldToken | null>(null);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selected && tokens.length > 0) setSelected(tokens[0]);
  }, [tokens, selected]);

  useEffect(() => {
    function onClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) setDropdownOpen(false);
    }
    document.addEventListener("mousedown", onClick);
    return () => document.removeEventListener("mousedown", onClick);
  }, []);

  const decimals = selected?.decimals ?? 9;
  const coinNotes = useMemo(
    () => (selected ? inboxNotes.filter((n) => !n.isSpent && n.tokenSymbol === selected.symbol) : []),
    [inboxNotes, selected],
  );
  const shieldedBalance = useMemo(() => coinNotes.reduce((sum, n) => sum + n.amount, 0n), [coinNotes]);
  const shieldedDisplay = useMemo(
    () => (Number(shieldedBalance) / 10 ** decimals).toLocaleString(undefined, { maximumFractionDigits: Math.min(decimals, 6) }),
    [shieldedBalance, decimals],
  );

  const handleSubmit = useCallback(async () => {
    setFormError(null);
    if (!selected || !keys || !selfMeta) return;
    if (!SUI_ADDRESS_RE.test(recipient.trim())) {
      setFormError("Enter a valid Sui recipient address");
      return;
    }
    const amountRaw = BigInt(Math.floor(parseFloat(amount || "0") * 10 ** decimals));
    if (amountRaw <= 0n) {
      setFormError("Enter an amount");
      return;
    }
    if (amountRaw > shieldedBalance) {
      setFormError(`Insufficient private ${selected.symbol} balance`);
      return;
    }
    const notes = selectNotes(coinNotes, amountRaw);
    await submit({
      coinType: selected.coinType,
      amount: amountRaw,
      recipient: recipient.trim(),
      selectedNotes: notes,
      keys,
      selfMeta,
    });
  }, [selected, keys, selfMeta, recipient, amount, decimals, shieldedBalance, coinNotes, submit]);

  if (status === "success" && selected) {
    const explorer = makeSuiExplorerLinks(
      getNetworkConfig(suiNetwork, { applyEnvOverrides: false }).sui?.explorerUrl ?? "",
      suiNetwork,
    );
    return (
      <div className={cn("space-y-4 py-6 text-center", className)}>
        <div className="inline-flex rounded-full border border-sui/20 bg-sui/10 p-3">
          <CheckCircle2 className="h-8 w-8 text-sui" />
        </div>
        <h3 className="text-lg font-semibold text-foreground">Cashed out</h3>
        <p className="text-caption text-gray">Your {selected.symbol} was released to the public address.</p>
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
              setRecipient("");
            }}
            className="rounded-[10px] border border-gray/15 bg-muted px-5 py-2 text-body2 text-gray-light transition-colors hover:bg-muted/80 hover:text-foreground cursor-pointer"
          >
            Cash out more
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
      <div className={cn("py-8 text-center", className)}>
        <p className="text-caption text-gray">No tokens registered for unshielding yet.</p>
      </div>
    );
  }

  const busy = status === "preparing" || status === "processing" || status === "submitting";
  const shownError = formError || error;
  const recipientTrimmed = recipient.trim();
  const recipientInvalid = recipientTrimmed.length > 0 && !SUI_ADDRESS_RE.test(recipientTrimmed);
  const canSubmit =
    !!selected && !!amount && parseFloat(amount) > 0 && SUI_ADDRESS_RE.test(recipientTrimmed) && !!keys && !!selfMeta;

  return (
    <div className={cn("space-y-5", className)}>
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-caption text-gray">Amount</span>
          <span className="text-caption text-gray/50">
            {selected ? `Private: ${shieldedDisplay} ${selected.symbol}` : ""}
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
            onClick={() => selected && setAmount((Number(shieldedBalance) / 10 ** decimals).toString())}
            className="rounded-[6px] border border-sui/20 bg-sui/10 px-2 py-1 text-[10px] font-semibold uppercase tracking-wider text-sui transition-colors hover:bg-sui/20 cursor-pointer"
          >
            Max
          </button>
          <div className="relative" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen((o) => !o)}
              className="flex items-center gap-1.5 rounded-[8px] border border-gray/15 bg-background/60 px-2.5 py-1.5 transition-colors hover:border-gray/30 cursor-pointer"
            >
              {selected?.logo && <Image src={selected.logo} alt={selected.symbol} width={20} height={20} className="rounded-full" />}
              <span className="text-sm font-semibold text-foreground">{selected?.symbol ?? "Select"}</span>
              <ChevronDown className={cn("h-3.5 w-3.5 text-gray transition-transform", dropdownOpen && "rotate-180")} />
            </button>
            {dropdownOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-[220px] overflow-hidden rounded-[12px] border border-gray/20 bg-card shadow-xl">
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
                    {token.logo && <Image src={token.logo} alt={token.symbol} width={20} height={20} className="rounded-full" />}
                    <div className="flex-1 text-left">
                      <div className="text-sm font-medium text-foreground">{token.symbol}</div>
                      <div className="text-[10px] text-gray">{token.name}</div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      <div className="space-y-2">
        <span className="text-caption text-gray">Recipient Sui address</span>
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="0x..."
          spellCheck={false}
          aria-invalid={recipientInvalid}
          className={cn(
            "w-full rounded-[12px] border bg-muted p-3 font-mono text-sm text-foreground placeholder:text-gray/30 outline-none transition-colors",
            recipientInvalid ? "border-red-500/40 focus:border-red-500/60" : "border-gray/15 focus:border-sui/30",
          )}
        />
        {recipientInvalid ? (
          <p className="text-[10px] text-red-400">Enter a valid Sui address (0x followed by up to 64 hex characters).</p>
        ) : (
          <p className="text-[10px] text-gray/50">Funds leave your private balance and arrive at this public Sui address. The relayer sponsors gas.</p>
        )}
      </div>

      {shownError && !busy && (
        <div className="flex items-center gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" />
          <span className="text-caption text-red-400">{shownError}</span>
        </div>
      )}

      <button
        onClick={handleSubmit}
        disabled={!canSubmit || busy}
        className={cn(
          "flex w-full items-center justify-center gap-2 rounded-[12px] py-3.5 text-body2 font-semibold transition-all cursor-pointer",
          canSubmit && !busy ? "bg-foreground text-background hover:bg-white" : "cursor-not-allowed bg-gray/20 text-gray/50",
        )}
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {statusMessage || "Processing..."}
          </>
        ) : (
          <>
            <Send className="h-4 w-4" />
            Cash out {selected?.symbol ?? ""}
          </>
        )}
      </button>
    </div>
  );
}
