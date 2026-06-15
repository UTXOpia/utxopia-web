"use client";

/**
 * SuiSendFlow — recipient-aware Sui private flow. One form serves both /send
 * and /vault/withdraw: the recipient decides the action, mirroring how the
 * Solana SendForm auto-detects.
 *
 *   • stealth address (utxo:…) or .utxopia.sui name → private transfer
 *   • public Sui address (0x…)                      → cash out (unshield)
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { LockKeyhole, Loader2, Send, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSuiShield, type SuiShieldToken } from "@/hooks/sui/use-sui-shield";
import { useSuiTransfer } from "@/hooks/sui/use-sui-transfer";
import { useSuiUnshield } from "@/hooks/sui/use-sui-unshield";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";
import { useUTXOpiaStore } from "@/stores";
import { networkForChain } from "@/lib/chain-registry";
import { makeSuiExplorerLinks } from "@/lib/chain-links";
import { getNetworkConfig } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { detectRecipient } from "./recipient-detect";
import { resolveSuiNsUtxopiaRecord } from "@/lib/sui/suins";
import {
  SuiFlowError,
  SuiFlowSuccess,
  SuiSubmitButton,
  SuiTokenAmountField,
  SuiTokensEmpty,
  SuiTokensLoading,
} from "@/components/sui/flow-kit";
import { RelayControl } from "@/components/relay/relay-control";
import { decodeStealthMetaAddress, type StealthMetaAddress } from "@utxopia/sdk";
import type { InboxNote } from "@/hooks/use-utxopia";

interface SuiSendFlowProps {
  className?: string;
}

const SUI_ADDRESS_RE = /^0x[0-9a-fA-F]{1,64}$/;
const NAME_RESOLVE_TIMEOUT_MS = 12_000;

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

export function SuiSendFlow({ className }: SuiSendFlowProps) {
  const { networkId } = useChainEnvironment();
  const suiNetwork = networkForChain(networkId, "sui");
  const keys = useUTXOpiaStore((s) => s.keys);
  const selfMeta = useUTXOpiaStore((s) => s.stealthAddress);
  const inboxNotes = useUTXOpiaStore((s) => s.inboxNotes);

  // Reuse the shield hook only for the registered-token list (symbol → coinType).
  const { tokens, loadingTokens } = useSuiShield(null);
  const transfer = useSuiTransfer();
  const unshield = useSuiUnshield();

  const [selected, setSelected] = useState<SuiShieldToken | null>(null);
  const [amount, setAmount] = useState("");
  const [recipient, setRecipient] = useState("");
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && tokens.length > 0) setSelected(tokens[0]);
  }, [tokens, selected]);

  const recipientTrimmed = recipient.trim();
  const isPublicSui = SUI_ADDRESS_RE.test(recipientTrimmed);
  const detection = useMemo(
    () => detectRecipient(recipientTrimmed, { chain: "sui" }),
    [recipientTrimmed],
  );
  const isStealth = detection.type === "stealth_suins" || detection.type === "stealth_meta";
  // Cash out to a public address vs. private transfer to a stealth recipient.
  const mode: "unshield" | "transfer" = isPublicSui ? "unshield" : "transfer";
  const recipientRecognized = isPublicSui || isStealth;

  const active = mode === "unshield" ? unshield : transfer;
  const provingElapsed = useElapsedSeconds(active.status === "processing");

  // Preview-resolve a SuiNS recipient so Send blocks before proving if the name
  // has no published UTXOpia receive metadata.
  type NameState =
    | { kind: "idle" }
    | { kind: "resolving" }
    | { kind: "found"; meta: StealthMetaAddress }
    | { kind: "not_found" };
  const [nameState, setNameState] = useState<NameState>({ kind: "idle" });
  useEffect(() => {
    if (detection.type !== "stealth_suins") {
      setNameState((prev) => (prev.kind === "idle" ? prev : { kind: "idle" }));
      return;
    }
    if (!recipientTrimmed) {
      setNameState({ kind: "idle" });
      return;
    }
    setNameState({ kind: "resolving" });
    let cancelled = false;
    const timeout = setTimeout(() => {
      if (!cancelled) setNameState({ kind: "not_found" });
    }, NAME_RESOLVE_TIMEOUT_MS);
    const settle = (next: NameState) => {
      if (cancelled) return;
      clearTimeout(timeout);
      setNameState(next);
    };
    void resolveSuiNsUtxopiaRecord(recipientTrimmed, networkId)
      .then((r) =>
        settle(
          r?.metadata
            ? {
                kind: "found",
                meta: {
                  spendingPubKey: new Uint8Array(32),
                  viewingPubKey: r.metadata.viewingPubKey,
                  mpk: r.metadata.mpk,
                } as StealthMetaAddress,
              }
            : { kind: "not_found" },
        ),
      )
      .catch(() => settle({ kind: "not_found" }));
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [detection.type, recipientTrimmed, networkId]);

  const decimals = selected?.decimals ?? 9;
  const coinNotes = useMemo(
    () => (selected ? inboxNotes.filter((n) => !n.isSpent && n.tokenSymbol === selected.symbol) : []),
    [inboxNotes, selected],
  );
  const shieldedBalance = useMemo(() => coinNotes.reduce((sum, n) => sum + n.amount, 0n), [coinNotes]);
  const shieldedDisplay = useMemo(
    () =>
      (Number(shieldedBalance) / 10 ** decimals).toLocaleString(undefined, {
        maximumFractionDigits: Math.min(decimals, 6),
      }),
    [shieldedBalance, decimals],
  );

  const handleSubmit = useCallback(async () => {
    setFormError(null);
    if (!selected || !keys || !selfMeta) return;
    if (!recipientRecognized) {
      setFormError("Enter a stealth address (utxo:…), a .utxopia.sui name, or a 0x Sui address");
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

    if (mode === "unshield") {
      await unshield.submit({
        coinType: selected.coinType,
        amount: amountRaw,
        recipient: recipientTrimmed,
        selectedNotes: notes,
        keys,
        selfMeta,
      });
      return;
    }

    let recipientMeta: StealthMetaAddress;
    try {
      if (detection.type === "stealth_suins") {
        if (nameState.kind === "found") {
          recipientMeta = nameState.meta;
        } else {
          const r = await resolveSuiNsUtxopiaRecord(recipientTrimmed, networkId);
          if (!r?.metadata) throw new Error(`Could not resolve UTXOpia metadata for ${recipientTrimmed}`);
          recipientMeta = {
            spendingPubKey: new Uint8Array(32),
            viewingPubKey: r.metadata.viewingPubKey,
            mpk: r.metadata.mpk,
          } as StealthMetaAddress;
        }
      } else {
        recipientMeta = decodeStealthMetaAddress(recipientTrimmed);
      }
    } catch (e) {
      setFormError(e instanceof Error ? e.message : "Invalid recipient");
      return;
    }

    await transfer.submit({
      coinType: selected.coinType,
      amount: amountRaw,
      recipientMeta,
      selectedNotes: notes,
      keys,
      selfMeta,
    });
  }, [
    selected,
    keys,
    selfMeta,
    recipientRecognized,
    amount,
    decimals,
    shieldedBalance,
    coinNotes,
    mode,
    detection.type,
    nameState,
    recipientTrimmed,
    networkId,
    transfer,
    unshield,
  ]);

  if (active.status === "success" && selected) {
    const explorer = makeSuiExplorerLinks(
      getNetworkConfig(suiNetwork, { applyEnvOverrides: false }).sui?.explorerUrl ?? "",
      suiNetwork,
    );
    return (
      <SuiFlowSuccess
        className={className}
        title={mode === "unshield" ? "Cashed out" : "Sent privately"}
        subtitle={
          mode === "unshield"
            ? `Your ${selected.symbol} was released to the public address.`
            : `Your ${selected.symbol} was sent as a private note. The amount and recipient stay hidden.`
        }
        txHref={active.txDigest ? explorer.tx(active.txDigest) : null}
        resetLabel={mode === "unshield" ? "Cash out more" : "Send more"}
        onReset={() => {
          active.reset();
          setAmount("");
          setRecipient("");
        }}
      />
    );
  }

  if (loadingTokens && tokens.length === 0) return <SuiTokensLoading className={className} />;
  if (tokens.length === 0) {
    return (
      <SuiTokensEmpty className={className}>
        <p className="text-caption text-gray">No tokens registered yet.</p>
      </SuiTokensEmpty>
    );
  }

  const busy =
    active.status === "preparing" || active.status === "processing" || active.status === "submitting";
  const shownError = formError || active.error;
  const recipientUnrecognized = recipientTrimmed.length > 0 && !recipientRecognized;
  const nameUnresolved = detection.type === "stealth_suins" && nameState.kind === "not_found";
  const canSubmit =
    !!selected &&
    !!amount &&
    parseFloat(amount) > 0 &&
    recipientRecognized &&
    !(detection.type === "stealth_suins" && nameState.kind !== "found") &&
    !!keys &&
    !!selfMeta;

  return (
    <div className={cn("space-y-5", className)}>
      <SuiTokenAmountField
        tokens={tokens}
        selected={selected}
        onSelect={setSelected}
        amount={amount}
        onAmount={setAmount}
        balanceLabel={selected ? `Private: ${shieldedDisplay} ${selected.symbol}` : ""}
        maxBaseUnits={shieldedBalance}
        decimals={decimals}
      />

      <div className="space-y-2">
        <span className="text-caption text-gray">Recipient</span>
        <input
          type="text"
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
          placeholder="utxo:… · alice.utxopia.sui · 0x…"
          spellCheck={false}
          aria-invalid={recipientUnrecognized}
          className={cn(
            "w-full rounded-[12px] border bg-muted p-3 font-mono text-sm text-foreground placeholder:text-gray/30 outline-none transition-colors",
            recipientUnrecognized || nameUnresolved
              ? "border-red-500/40 focus:border-red-500/60"
              : "border-gray/15 focus:border-sui/30",
          )}
        />
        {recipientUnrecognized ? (
          <p className="text-[10px] text-red-400">
            Enter a stealth address (utxo:…), a .utxopia.sui name, or a 0x Sui address.
          </p>
        ) : nameUnresolved ? (
          <p className="text-[10px] text-red-400">This name has not published UTXOpia receive metadata.</p>
        ) : detection.type === "stealth_suins" && nameState.kind === "resolving" ? (
          <p className="inline-flex items-center gap-1.5 text-[10px] text-gray/50">
            <Loader2 className="h-3 w-3 animate-spin" /> Resolving name…
          </p>
        ) : isPublicSui ? (
          <p className="inline-flex items-center gap-1.5 text-[10px] text-gray/60">
            <Wallet className="h-3 w-3" /> Cash out — funds arrive at this public Sui address. The relayer sponsors gas.
          </p>
        ) : isStealth ? (
          <p className="inline-flex items-center gap-1.5 text-[10px] text-privacy">
            <LockKeyhole className="h-3 w-3" /> Private transfer — amount and recipient stay hidden.
          </p>
        ) : (
          <p className="text-[10px] text-gray/50">
            Send privately to a name or stealth address, or cash out to a 0x Sui address.
          </p>
        )}
      </div>

      {shownError && !busy && <SuiFlowError message={shownError} />}

      {/* Per-tx relay line — low-emphasis reassurance above the submit button.
          viaAuditor is dormant (default false) until the app tracks
          permissioned pools. */}
      {canSubmit && (
        <RelayControl chainId="sui" networkId={suiNetwork} viaAuditor={false} />
      )}

      <SuiSubmitButton
        busy={busy}
        canSubmit={canSubmit}
        busyLabel={active.statusMessage || "Processing..."}
        idleLabel={`${mode === "unshield" ? "Cash out" : "Send"} ${selected?.symbol ?? ""}`}
        idleIcon={<Send className="h-4 w-4" />}
        provingElapsed={provingElapsed}
        onClick={handleSubmit}
      />
    </div>
  );
}
