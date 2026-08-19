"use client";

import { useState, useMemo, useEffect, useRef, useCallback, Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import {
  ArrowUp,
  ArrowDown,
  ArrowLeft,
  History,
  LockKeyhole,
  ExternalLink,
  Copy,
  Check,
  RefreshCw,
  Loader2,
  AlertTriangle,
  Search,
  ShieldCheck,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";
import { useUTXOpiaKeys, useStealthInbox } from "@/hooks/use-utxopia";
import { usePasskey } from "@/hooks/use-passkey";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { AuthModal } from "@/components/auth-modal";
import { EmptyInbox } from "@/components/stealth-inbox";

import { SUPPORTED_TOKENS, getTokenBySymbol, type SupportedToken } from "@/lib/supported-tokens";
import { useTokenPrices, type TokenPrices } from "@/hooks/use-token-prices";
import type { InboxNote } from "@/stores/utxopia-store";
import { hrefWithChain } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { Tooltip } from "@/components/ui/tooltip";
import {
  getPendingFaucetActivities,
  type PendingFaucetActivity,
} from "@/lib/faucet-activity";
import { getAlphaDemoNetworkInboxNotes } from "@/lib/alpha-demo-ledger";
import {
  getSubmittedActivityDisplaySymbol,
  getSubmittedTransactions,
  getSubmittedTransactionsForNetwork,
  type SubmittedTransactionActivity,
} from "@/lib/transaction-activity";
import { vaultsSupported } from "@/lib/vault-config";
import { useSiblingVaultBalances } from "@/hooks/use-sibling-vault-balances";
import { getChainTransactionUrl } from "@/lib/chain-links";
import {
  indexOwnedNoteOrigins,
  reconcileSubmittedActivity,
  recoverSelfTransferActivities,
  type IndexedPrivateTransaction,
  type OwnedNoteOrigin,
} from "@/lib/activity-reconciliation";
import {
  activityAnnotationsEventName,
  getActivityAnnotations,
  saveActivityAnnotation,
  type ActivityAnnotation,
} from "@/lib/activity-annotations";
import { PersonalAnnotationEditor } from "@/components/activity/personal-annotation-editor";
import { PRODUCT_COPY } from "@/lib/product-language";
import { describeDepositStatus } from "@/lib/deposit-status";

function getToken(sym: string): SupportedToken {
  return getTokenBySymbol(sym) || SUPPORTED_TOKENS[0];
}

function formatAmt(amount: bigint | number, token: SupportedToken): string {
  const num = Number(amount) / 10 ** token.decimals;
  const maxDec = Math.min(token.decimals, 6);
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: maxDec });
}

function formatDateKey(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
}

function formatFullDate(ts: number): string {
  return new Date(ts).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  }) + " \u00B7 " + new Date(ts).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
    hour12: true,
  });
}

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(ts).toLocaleDateString();
}

function ActivityRow({
  note,
  tokenPrices,
  origin,
  annotation,
  onSaveAnnotation,
}: {
  note: InboxNote;
  tokenPrices: TokenPrices;
  origin?: OwnedNoteOrigin;
  annotation?: ActivityAnnotation;
  onSaveAnnotation: (input: { label?: string; note?: string }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { networkId: network, vaultId: activeVaultId, config } = useChainEnvironment();
  const token = getToken(note.tokenSymbol);
  const price = tokenPrices[token.priceKey];
  const usdValue = price ? (Number(note.amount) / 10 ** token.decimals) * price : 0;
  const isHistoricalFunding = origin?.kind === "btc_deposit" || origin?.kind === "shield";
  const isReceived = isHistoricalFunding || !note.isSpent;
  const receivedLabel = origin?.kind === "btc_deposit"
    ? "BTC deposit"
    : origin?.kind === "shield"
      ? "Added privately"
      : "Received";
  const receivedType = origin?.kind === "btc_deposit"
    ? "BTC deposited into private balance"
    : origin?.kind === "shield"
      ? "Asset shielded into private vault"
      : "Private transfer received";
  const originTxUrl = origin?.txSignature
    ? getChainTransactionUrl(config, origin.txSignature, network)
    : null;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    await navigator.clipboard.writeText(note.commitmentHex);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      {/* Collapsed row */}
      <div
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2.5 px-4 py-3 transition-colors cursor-pointer",
          expanded ? "bg-muted/50" : "hover:bg-muted/40"
        )}
      >
        {/* Arrow indicator */}
        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
          isReceived ? "bg-privacy/10" : "bg-gray/10"
        )}>
          {isReceived
            ? <ArrowDown className="w-3.5 h-3.5 text-privacy" />
            : <ArrowUp className="w-3.5 h-3.5 text-gray" />
          }
        </div>

        {/* Label + time */}
        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground font-medium inline-flex items-center gap-1.5">
            {annotation?.label ?? (isReceived ? receivedLabel : "Note spent")}
            {(note.vaultId ?? activeVaultId) === "verified" && (
              <ShieldCheck className="w-3 h-3 text-privacy/70 shrink-0" aria-label="Verified vault" />
            )}
          </span>
          <p className="text-[11px] text-gray/40">{timeAgo(note.createdAt)}</p>
        </div>

        {/* Amount + token */}
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="text-right">
            <p className={cn(
              "text-sm font-semibold font-mono tabular-nums",
              isReceived ? "text-privacy" : "text-gray"
            )}>
              {isReceived ? "+" : "-"}{formatAmt(note.amount, token)}{" "}
              <span className="text-xs font-medium">{token.shieldedSymbol}</span>
            </p>
            {usdValue > 0 && (
              <p
                className="text-[11px] text-gray/45 font-mono tabular-nums"
                title="Estimated using the current market price"
              >
                ≈ ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} now
              </p>
            )}
          </div>
          {originTxUrl && (
            <a
              href={originTxUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="View Solana transaction"
              title="View Solana transaction"
              onClick={(event) => event.stopPropagation()}
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray/45 transition-colors hover:bg-gray/8 hover:text-privacy focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-privacy/40"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {/* Expanded detail — explorer-style card */}
      {expanded && (
        <div className="mx-4 mb-3">
          <div className="rounded-[10px] bg-linear-to-b from-gray/6 to-transparent border border-gray/10 overflow-hidden">
            {/* Amount header */}
            <div className={cn(
              "px-3.5 py-2.5 border-b border-gray/8",
              isReceived ? "bg-privacy/4" : "bg-gray/4"
            )}>
              <div className="flex items-center gap-2">
                <img src={token.shieldedLogo} alt={token.shieldedSymbol} className="w-5 h-5 rounded-full" />
                <span className={cn(
                  "text-sm font-semibold font-mono tabular-nums",
                  isReceived ? "text-privacy" : "text-gray"
                )}>
                  {formatAmt(note.amount, token)} {token.shieldedSymbol}
                </span>
                {usdValue > 0 && (
                  <span className="text-[11px] text-gray/40 font-mono ml-auto">
                    ≈ ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} now
                  </span>
                )}
              </div>
            </div>

            {/* Info rows */}
            <div className="px-3.5 py-2 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-gray/40">Type</span>
                <span className="text-foreground/80">
                  {isReceived ? receivedType : "Spent note (transfer details unavailable)"}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray/40">Time</span>
                <span className="text-gray/60">{formatFullDate(note.createdAt)}</span>
              </div>
              {isHistoricalFunding && note.isSpent && (
                <div className="flex justify-between">
                  <span className="text-gray/40">Current status</span>
                  <span className="text-gray/60">Spent in a later transaction</span>
                </div>
              )}
              <div className="flex justify-between">
                <Tooltip content="This note's position in the on-chain Merkle tree of shielded commitments. It lets you prove the note exists without revealing which one is yours.">
                  <span className="text-gray/40">Leaf Index</span>
                </Tooltip>
                <span className="text-gray/60 font-mono">#{note.leafIndex}</span>
              </div>
              <div className="flex items-center justify-between gap-2">
                <Tooltip content="The public, encrypted fingerprint of this note stored on-chain. It hides the amount and owner — only you can spend it.">
                  <span className="text-gray/40 shrink-0">Commitment</span>
                </Tooltip>
                <div className="flex items-center gap-1 min-w-0">
                  <code className="text-[10px] font-mono text-foreground/60 truncate">
                    {note.commitmentHex.slice(0, 10)}...{note.commitmentHex.slice(-6)}
                  </code>
                  <button
                    onClick={handleCopy}
                    className="p-0.5 rounded hover:bg-gray/10 transition-colors shrink-0"
                  >
                    {copied
                      ? <Check className="w-2.5 h-2.5 text-privacy" />
                      : <Copy className="w-2.5 h-2.5 text-gray/40" />
                    }
                  </button>
                </div>
              </div>
            </div>

            <PersonalAnnotationEditor annotation={annotation} onSave={onSaveAnnotation} />

            {/* Footer — explorer link */}
            <div className="px-3.5 py-2 border-t border-gray/8">
              <Link
                href={origin?.txSignature
                  ? getChainTransactionUrl(config, origin.txSignature, network)
                  : hrefWithChain("/explorer", network)}
                className="inline-flex items-center gap-1.5 text-[11px] text-privacy hover:text-privacy/80 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
                {origin?.txSignature ? "View transaction" : "View in Explorer"}
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PendingFaucetRow({
  activity,
  tokenPrices,
  annotation,
  onSaveAnnotation,
  backendStatus,
}: {
  activity: PendingFaucetActivity;
  tokenPrices: TokenPrices;
  annotation?: ActivityAnnotation;
  onSaveAnnotation: (input: { label?: string; note?: string }) => void;
  /** Lifecycle state the indexer reports for this deposit, if it has seen it. */
  backendStatus?: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const { config } = useChainEnvironment();
  const token = getToken("zkBTC");
  const price = tokenPrices[token.priceKey];
  const usdValue = price ? (Number(activity.amountSats) / 10 ** token.decimals) * price : 0;
  // Fall back to the local optimistic state only while the indexer has nothing
  // to say about this txid yet.
  const pendingState = describeDepositStatus(backendStatus ?? activity.status);
  const btcTxUrl = activity.txid
    ? `${config.bitcoin.explorerUrl.replace(/\/$/, "")}/tx/${activity.txid}`
    : null;

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2.5 px-4 py-3 transition-colors cursor-pointer",
          expanded ? "bg-muted/50" : "hover:bg-muted/40",
        )}
      >
        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-warning/10">
          <Loader2 className="w-3.5 h-3.5 text-warning animate-spin" />
        </div>

        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground font-medium">
            {annotation?.label ?? "Faucet deposit"}
          </span>
          <p className={cn("text-[11px]", pendingState.color)}>
            {pendingState.label} · {timeAgo(activity.createdAt)}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <div className="text-right">
            <p className="text-sm font-semibold font-mono tabular-nums text-warning">
              +{formatAmt(activity.amountSats, token)}{" "}
              <span className="text-xs font-medium">{token.shieldedSymbol}</span>
            </p>
            {usdValue > 0 && (
              <p
                className="text-[11px] text-gray/45 font-mono tabular-nums"
                title="Estimated using the current market price"
              >
                ≈ ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} now
              </p>
            )}
          </div>
          {btcTxUrl && (
            <a
              href={btcTxUrl}
              target="_blank"
              rel="noreferrer"
              aria-label="View Bitcoin transaction"
              title="View Bitcoin transaction"
              onClick={(event) => event.stopPropagation()}
              className="flex h-8 w-8 items-center justify-center rounded-md text-gray/45 transition-colors hover:bg-gray/8 hover:text-warning focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/40"
            >
              <ExternalLink className="h-3.5 w-3.5" />
            </a>
          )}
        </div>
      </div>

      {expanded && (
        <div className="mx-4 mb-3">
          <div className="rounded-[10px] overflow-hidden border border-warning/15 bg-warning/5">
            <div className="px-3.5 py-2.5 border-b border-warning/10">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-warning animate-spin" />
                <span className="text-sm font-semibold text-warning">Processing on regtest</span>
              </div>
            </div>

            <div className="px-3.5 py-2 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-gray/40">Status</span>
                <span className="text-warning">BTC confirmed, vault credit pending</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray/40">Time</span>
                <span className="text-gray/60">{formatFullDate(activity.createdAt)}</span>
              </div>
              {activity.blocksMined != null && (
                <div className="flex justify-between">
                  <span className="text-gray/40">Blocks mined</span>
                  <span className="text-gray/60 font-mono">{activity.blocksMined}</span>
                </div>
              )}
              {activity.txid && (
                <div className="flex items-center justify-between gap-2">
                  <span className="text-gray/40 shrink-0">BTC tx</span>
                  <code className="text-[10px] font-mono text-foreground/60 truncate">
                    {activity.txid.slice(0, 12)}...{activity.txid.slice(-8)}
                  </code>
                </div>
              )}
            </div>

            <PersonalAnnotationEditor annotation={annotation} onSave={onSaveAnnotation} />

            <div className="px-3.5 py-2 border-t border-warning/10">
              {btcTxUrl && <a
                href={btcTxUrl}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-[11px] text-warning transition-colors hover:text-warning/80"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
                View Bitcoin transaction
              </a>}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SUBMITTED_LABELS: Record<SubmittedTransactionActivity["kind"], { label: string; incoming?: boolean }> = {
  private_send: { label: PRODUCT_COPY.transactions.privateTransfer },
  claim_link: { label: "Claim link funded" },
  claim_receive: { label: "Claim link received", incoming: true },
  cashout_btc: { label: PRODUCT_COPY.transactions.withdrawBtc },
  cashout_wallet: { label: PRODUCT_COPY.transactions.cashOut },
};

function SubmittedTransactionRow({
  activity,
  tokenPrices,
  isSelfTransfer = false,
  annotation,
  onSaveAnnotation,
}: {
  activity: SubmittedTransactionActivity;
  tokenPrices: TokenPrices;
  isSelfTransfer?: boolean;
  annotation?: ActivityAnnotation;
  onSaveAnnotation: (input: { label?: string; note?: string }) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { networkId, config } = useChainEnvironment();
  const token = getToken(activity.tokenSymbol);
  const baseMeta = SUBMITTED_LABELS[activity.kind];
  const meta = {
    ...baseMeta,
    label: activity.kind === "private_send"
      ? PRODUCT_COPY.transactions.privateTransfer
      : activity.kind === "cashout_wallet"
        ? PRODUCT_COPY.transactions.cashOut
        : baseMeta.label,
  };
  const displaySymbol = getSubmittedActivityDisplaySymbol(activity.kind, token.shieldedSymbol);
  const [redemption, setRedemption] = useState<{
    btcTxid: string | null;
    localStatus: string | null;
    trackerError: string | null;
    netAmountBaseUnits: string | null;
    feeBaseUnits: string | null;
  } | null>(null);
  const [walletSettlement, setWalletSettlement] = useState<{
    netAmountBaseUnits: string | null;
    feeBaseUnits: string | null;
  } | null>(null);

  useEffect(() => {
    if (activity.kind !== "cashout_btc" && activity.kind !== "cashout_wallet") return;
    let cancelled = false;
    const sync = async () => {
      try {
        const endpoint = activity.kind === "cashout_btc"
          ? "/api/explorer/redemptions"
          : "/api/explorer/transactions";
        const response = await fetch(`${endpoint}?network=${encodeURIComponent(networkId)}`, {
          cache: "no-store",
        });
        if (!response.ok) return;
        if (activity.kind === "cashout_btc") {
          const data = await response.json() as { redemptions?: Array<{
            requestTxSignature?: string;
            btcTxid?: string | null;
            localStatus?: string | null;
            trackerError?: string | null;
            amountSats?: string;
            actualReceived?: string | null;
            serviceFee?: string | null;
          }> };
          const match = data.redemptions?.find((item) => item.requestTxSignature === activity.signature);
          if (!cancelled && match) {
            const netAmount = match.actualReceived ?? (
              match.amountSats && match.serviceFee
                ? (BigInt(match.amountSats) - BigInt(match.serviceFee)).toString()
                : null
            );
            setRedemption({
              btcTxid: match.btcTxid ?? null,
              localStatus: match.localStatus ?? null,
              trackerError: match.trackerError ?? null,
              netAmountBaseUnits: netAmount,
              feeBaseUnits: match.serviceFee ?? null,
            });
          }
        } else {
          const data = await response.json() as { transactions?: Array<{
            txSignature?: string;
            outputs?: Array<{ type?: string; payout?: number; fee?: number }>;
          }> };
          const match = data.transactions?.find((item) => item.txSignature === activity.signature);
          const payout = match?.outputs?.find((output) =>
            output.type === "unshield" || output.type === "withdraw"
          );
          if (!cancelled && payout) {
            setWalletSettlement({
              netAmountBaseUnits: payout.payout != null ? String(payout.payout) : null,
              feeBaseUnits: payout.fee != null ? String(payout.fee) : null,
            });
          }
        }
      } catch {
        // Keep the on-chain request status when the tracker is temporarily unavailable.
      }
    };
    void sync();
    const timer = window.setInterval(sync, 8_000);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [activity.kind, activity.signature, networkId]);

  const redemptionFailed = redemption?.localStatus?.toLowerCase() === "failed";
  const redemptionPending = activity.kind === "cashout_btc" && !redemption?.btcTxid && !redemptionFailed;
  const statusText = redemption?.btcTxid
    ? "Bitcoin transaction broadcast"
    : redemptionFailed
      ? redemption.trackerError || "Bitcoin broadcast failed"
      : "Waiting for Bitcoin broadcast";
  const settlement = activity.kind === "cashout_btc" ? redemption : walletSettlement;
  const netAmountBaseUnits = settlement?.netAmountBaseUnits ?? activity.netAmountBaseUnits ?? null;
  const feeAmountBaseUnits = settlement?.feeBaseUnits ?? activity.protocolFeeBaseUnits ?? null;
  // Legacy BTC activity stored the net payout in amountBaseUnits. Once the
  // tracker supplies settlement data, reconstruct gross so old rows remain
  // correctly labelled after the gross/fee/net UI upgrade.
  const grossAmountBaseUnits = activity.kind === "cashout_btc" && settlement?.netAmountBaseUnits && settlement.feeBaseUnits
    ? (BigInt(settlement.netAmountBaseUnits) + BigInt(settlement.feeBaseUnits)).toString()
    : activity.amountBaseUnits;
  const displayAmountBaseUnits = isSelfTransfer
    ? "0"
    : netAmountBaseUnits ?? activity.amountBaseUnits;
  const price = tokenPrices[token.priceKey];
  const usdValue = price
    ? (Number(displayAmountBaseUnits) / 10 ** token.decimals) * price
    : 0;
  const amountPrefix = isSelfTransfer ? "" : meta.incoming ? "+" : "-";

  const copySignature = async (event: React.MouseEvent) => {
    event.stopPropagation();
    await navigator.clipboard.writeText(activity.signature);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div>
      <div
        onClick={() => setExpanded(!expanded)}
        className={cn(
          "flex items-center gap-2.5 px-4 py-3 transition-colors cursor-pointer",
          expanded ? "bg-muted/50" : "hover:bg-muted/40",
        )}
      >
        <div className={cn(
          "w-6 h-6 rounded-full flex items-center justify-center shrink-0",
          redemptionFailed ? "bg-error/10" : "bg-success/10",
        )}>
          {redemptionFailed ? (
            <AlertTriangle className="w-3.5 h-3.5 text-error" />
          ) : redemptionPending ? (
            <Loader2 className="w-3.5 h-3.5 text-gray animate-spin" />
          ) : (
            <Check className="w-3.5 h-3.5 text-success" />
          )}
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground font-medium inline-flex items-center gap-1.5">
            {annotation?.label ?? meta.label}
            {(activity.vaultId ?? "open") === "verified" && (
              <ShieldCheck className="w-3 h-3 text-privacy/70 shrink-0" aria-label="Verified vault" />
            )}
          </span>
          <p className={cn(
            "text-[11px]",
            redemptionFailed ? "text-error/75" : redemptionPending ? "text-gray/60" : "text-success/75",
          )}>
            {redemptionFailed
              ? `Failed · ${timeAgo(activity.createdAt)}`
              : redemptionPending
                ? `Processing · ${timeAgo(activity.createdAt)}`
                : timeAgo(activity.createdAt)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <div className="text-right">
            <p className={cn(
              "text-sm font-semibold font-mono tabular-nums",
              meta.incoming ? "text-privacy" : "text-gray",
            )}>
              {amountPrefix}{formatAmt(BigInt(displayAmountBaseUnits), token)}{" "}
              <span className="text-xs font-medium">{displaySymbol}</span>
            </p>
            {usdValue > 0 && (
              <p
                className="text-[11px] text-gray/45 font-mono tabular-nums"
                title="Estimated using the current market price"
              >
                ≈ ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} now
              </p>
            )}
          </div>
          <a
            href={getChainTransactionUrl(config, activity.signature, networkId)}
            target="_blank"
            rel="noreferrer"
            aria-label="View Solana transaction"
            title="View Solana transaction"
            onClick={(event) => event.stopPropagation()}
            className="flex h-8 w-8 items-center justify-center rounded-md text-gray/45 transition-colors hover:bg-gray/8 hover:text-success focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-success/40"
          >
            <ExternalLink className="h-3.5 w-3.5" />
          </a>
        </div>
      </div>

      {expanded && (
        <div className="mx-4 mb-3 rounded-[10px] border border-success/15 bg-success/4 overflow-hidden">
          <div className="px-3.5 py-2 space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-gray/40">Type</span>
              <span className="text-foreground/80 text-right">{meta.label}</span>
            </div>
            {(activity.kind === "cashout_btc" || redemptionFailed) && (
              <div className="flex justify-between gap-3">
                <span className="text-gray/40">Status</span>
                <span className={cn("text-right", redemptionFailed ? "text-error" : "text-success")}>
                  {statusText}
                </span>
              </div>
            )}
            <div className="flex justify-between gap-3">
              <span className="text-gray/40">Time</span>
              <span className="text-gray/60 text-right">{formatFullDate(activity.createdAt)}</span>
            </div>
            {usdValue > 0 && (
              <div className="flex justify-between gap-3">
                <span className="text-gray/40">Current value</span>
                <span className="font-mono text-gray/60 text-right">
                  ≈ ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              </div>
            )}
            {isSelfTransfer && (
              <div className="flex justify-between gap-3">
                <span className="text-gray/40">Transfer</span>
                <span className="text-foreground/80 text-right">Sent to your private address</span>
              </div>
            )}
            {(activity.kind === "cashout_btc" || activity.kind === "cashout_wallet") && (
              <div className="flex justify-between gap-3">
                <span className="text-gray/40">Amount before fees</span>
                <span className="font-mono text-foreground/80 text-right">
                  {formatAmt(BigInt(grossAmountBaseUnits), token)} {displaySymbol}
                </span>
              </div>
            )}
            {netAmountBaseUnits && (
              <div className="flex justify-between gap-3">
                <span className="text-gray/40">Net received</span>
                <span className="font-mono text-foreground/80 text-right">
                  {formatAmt(BigInt(netAmountBaseUnits), token)} {displaySymbol}
                </span>
              </div>
            )}
            {feeAmountBaseUnits && BigInt(feeAmountBaseUnits) > 0n && (
              <div className="flex justify-between gap-3">
                <span className="text-gray/40">Protocol fee</span>
                <span className="font-mono text-gray/60 text-right">
                  {formatAmt(BigInt(feeAmountBaseUnits), token)} {displaySymbol}
                </span>
              </div>
            )}
            {activity.relayerFeeBaseUnits && BigInt(activity.relayerFeeBaseUnits) > 0n && (
              <div className="flex justify-between gap-3">
                <span className="text-gray/40">{PRODUCT_COPY.protocol.relayerFee}</span>
                <span className="font-mono text-gray/60 text-right">
                  {formatAmt(BigInt(activity.relayerFeeBaseUnits), token)} {token.shieldedSymbol}
                </span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <span className="text-gray/40 shrink-0">Transaction</span>
              <div className="flex items-center gap-1 min-w-0">
                <code className="text-[10px] font-mono text-foreground/60 truncate">
                  {activity.signature.slice(0, 12)}...{activity.signature.slice(-8)}
                </code>
                <button
                  type="button"
                  onClick={copySignature}
                  aria-label="Copy transaction signature"
                  className="p-0.5 rounded hover:bg-gray/10 transition-colors shrink-0"
                >
                  {copied
                    ? <Check className="w-2.5 h-2.5 text-success" />
                    : <Copy className="w-2.5 h-2.5 text-gray/40" />}
                </button>
              </div>
            </div>
          </div>
          <PersonalAnnotationEditor annotation={annotation} onSave={onSaveAnnotation} />
          <div className="px-3.5 py-2 border-t border-success/10">
            <a
              href={getChainTransactionUrl(config, activity.signature, networkId)}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-[11px] text-success hover:text-success/80 transition-colors"
              onClick={(event) => event.stopPropagation()}
            >
              <ExternalLink className="w-3 h-3" />
              View transaction
            </a>
          </div>
        </div>
      )}
    </div>
  );
}

type ActivityItem =
  | { kind: "note"; id: string; createdAt: number; note: InboxNote; origin?: OwnedNoteOrigin }
  | { kind: "pending-faucet"; id: string; createdAt: number; activity: PendingFaucetActivity }
  | {
      kind: "submitted";
      id: string;
      createdAt: number;
      activity: SubmittedTransactionActivity;
      outputCommitments: string[];
      isSelfTransfer: boolean;
    };

function annotationIdForActivity(item: ActivityItem): string {
  if (item.kind === "note") return `note:${item.note.commitmentHex.toLowerCase()}`;
  if (item.kind === "submitted") return `tx:${item.activity.signature}`;
  return `pending:${item.activity.id}`;
}

const INDEXED_ACTIVITY_CACHE_PREFIX = "utxopia:indexed-activity:v1";
const INDEXED_ACTIVITY_CACHE_TTL_MS = 5 * 60 * 1000;

function readIndexedActivityCache(networkId: string): IndexedPrivateTransaction[] | null {
  if (typeof window === "undefined") return null;
  try {
    const cached = JSON.parse(
      sessionStorage.getItem(`${INDEXED_ACTIVITY_CACHE_PREFIX}:${networkId}`) || "null",
    ) as { savedAt?: number; transactions?: IndexedPrivateTransaction[] } | null;
    if (
      !cached?.savedAt
      || Date.now() - cached.savedAt > INDEXED_ACTIVITY_CACHE_TTL_MS
      || !Array.isArray(cached.transactions)
    ) {
      return null;
    }
    return cached.transactions;
  } catch {
    return null;
  }
}

function writeIndexedActivityCache(
  networkId: string,
  transactions: IndexedPrivateTransaction[],
): void {
  try {
    sessionStorage.setItem(
      `${INDEXED_ACTIVITY_CACHE_PREFIX}:${networkId}`,
      JSON.stringify({ savedAt: Date.now(), transactions }),
    );
  } catch {
    // Public explorer enrichment is an optimization; live fetch remains authoritative.
  }
}

function ActivityFeed() {
  const { notes, isLoading, error: inboxError, refresh } = useStealthInbox();
  const tokenPrices = useTokenPrices();
  const searchParams = useSearchParams();
  const { networkId, vaultId, config } = useChainEnvironment();
  const stealthAddress = useUTXOpiaStore((s) => s.stealthAddressEncoded);
  const [pendingActivities, setPendingActivities] = useState<PendingFaucetActivity[]>([]);
  const [btcTxStatuses, setBtcTxStatuses] = useState<Map<string, string>>(new Map());
  const [submittedActivities, setSubmittedActivities] = useState<SubmittedTransactionActivity[]>([]);
  const [indexedTransactions, setIndexedTransactions] = useState<IndexedPrivateTransaction[]>([]);
  const [hashQuery, setHashQuery] = useState("");
  const [isRefreshingAll, setIsRefreshingAll] = useState(false);
  const [isLoadingIndexed, setIsLoadingIndexed] = useState(true);
  const [hasIndexedSnapshot, setHasIndexedSnapshot] = useState(false);
  const [historyLoadError, setHistoryLoadError] = useState<string | null>(null);
  const [historyRetry, setHistoryRetry] = useState(0);
  const [annotations, setAnnotations] = useState<Record<string, ActivityAnnotation>>({});
  const historySyncKey = `${networkId}:${stealthAddress ?? "locked"}`;
  const alphaDemoNotes = useMemo(() => {
    const scoped = getAlphaDemoNetworkInboxNotes(networkId, stealthAddress);
    return scoped.length > 0 ? scoped : getAlphaDemoNetworkInboxNotes(networkId);
  }, [networkId, stealthAddress]);
  const siblingVault = useSiblingVaultBalances();
  const displayNotes = useMemo(() => {
    const byId = new Map<string, InboxNote>();
    for (const note of notes) byId.set(note.id, note);
    for (const note of siblingVault.notes) byId.set(note.id, note);
    for (const note of alphaDemoNotes) byId.set(note.id, note);
    return Array.from(byId.values());
  }, [alphaDemoNotes, notes, siblingVault.notes]);

  useEffect(() => {
    const sync = () => {
      const creditedBtcTxids = new Set(
        indexedTransactions.flatMap((transaction) =>
          transaction.btcDepositTxid ? [transaction.btcDepositTxid] : []
        ),
      );
      // A pending row only disappears once its deposit is credited, so until
      // then it is the only thing the user can look at. The backend already
      // classifies these — showing a fixed "Processing" hid states like
      // "stalled" behind a spinner that implied everything was on track.
      setBtcTxStatuses(new Map(
        indexedTransactions.flatMap((transaction) =>
          transaction.btcDepositTxid && transaction.status
            ? [[transaction.btcDepositTxid, transaction.status] as const]
            : []
        ),
      ));
      setPendingActivities(getPendingFaucetActivities({
        networkId,
        stealthAddress,
        creditedBtcTxids,
        currentPoolAddress: config.bitcoin.poolAddress,
      }));
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("utxopia:faucet-activity", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("utxopia:faucet-activity", sync);
    };
  }, [config.bitcoin.poolAddress, indexedTransactions, networkId, stealthAddress]);

  useEffect(() => {
    const sync = () =>
      setSubmittedActivities(
        vaultsSupported(networkId)
          ? getSubmittedTransactionsForNetwork(networkId)
          : getSubmittedTransactions(networkId, vaultId),
      );
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("utxopia:transaction-activity", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("utxopia:transaction-activity", sync);
    };
  }, [networkId, vaultId]);

  useEffect(() => {
    const sync = () => setAnnotations(getActivityAnnotations(networkId));
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener(activityAnnotationsEventName(), sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener(activityAnnotationsEventName(), sync);
    };
  }, [networkId]);

  const updateAnnotation = useCallback((
    activityId: string,
    input: { label?: string; note?: string },
  ) => {
    setAnnotations(saveActivityAnnotation(networkId, activityId, input));
  }, [networkId]);

  const fetchIndexedTransactions = useCallback(async (): Promise<IndexedPrivateTransaction[]> => {
    const response = await fetch(`/api/explorer/transactions?network=${encodeURIComponent(networkId)}`, {
      cache: "no-store",
    });
    if (!response.ok) throw new Error(`Activity request failed with ${response.status}`);
    const data = await response.json() as { transactions?: Array<{
      txSignature?: string;
      timestamp?: number;
      type?: string;
      inputs?: Array<{ nullifierHash?: string; btcDepositTxid?: string }>;
      outputs?: Array<{ commitment?: string }>;
      btcMeta?: { depositTxid?: string | null };
      status?: string;
    }> };
    return (data.transactions ?? []).flatMap((transaction) =>
      transaction.txSignature && Number.isFinite(transaction.timestamp)
        ? [{
            txSignature: transaction.txSignature,
            timestamp: transaction.timestamp!,
            type: transaction.type,
            inputs: transaction.inputs ?? [],
            outputs: transaction.outputs ?? [],
            btcDepositTxid: transaction.btcMeta?.depositTxid ?? undefined,
            status: transaction.status,
          }]
        : []
    );
  }, [networkId]);

  useEffect(() => {
    let cancelled = false;
    const activityIdentity = `${networkId}:${vaultId}`;
    const cached = readIndexedActivityCache(activityIdentity);
    setIndexedTransactions(cached ?? []);
    setHasIndexedSnapshot(cached !== null);
    setIsLoadingIndexed(true);
    setHistoryLoadError(null);

    const sync = async () => {
      try {
        const transactions = await fetchIndexedTransactions();
        if (cancelled) return;
        setIndexedTransactions(transactions);
        setHasIndexedSnapshot(true);
        writeIndexedActivityCache(activityIdentity, transactions);
      } catch (error) {
        if (!cancelled) {
          setHistoryLoadError(error instanceof Error ? error.message : "Could not load complete history");
        }
      } finally {
        if (!cancelled) setIsLoadingIndexed(false);
      }
    };

    // Inbox scanning and public explorer enrichment are independent. Let each
    // source become visible when it is trustworthy instead of blocking the
    // whole feed on the slower request.
    void refresh(undefined, searchParams.get("refresh") === "inbox");
    void sync();
    return () => { cancelled = true; };
  }, [fetchIndexedTransactions, historyRetry, historySyncKey, networkId, refresh, searchParams, vaultId]);

  const refreshAllActivity = useCallback(async () => {
    if (isRefreshingAll) return;
    setIsRefreshingAll(true);
    setIsLoadingIndexed(true);
    setHistoryLoadError(null);
    try {
      const nextSubmitted = getSubmittedTransactions(networkId, vaultId);
      setSubmittedActivities(nextSubmitted);
      const [inboxResult, indexedResult] = await Promise.allSettled([
        refresh(undefined, true),
        fetchIndexedTransactions(),
      ]);
      if (indexedResult.status === "fulfilled") {
        setIndexedTransactions(indexedResult.value);
        setHasIndexedSnapshot(true);
        writeIndexedActivityCache(`${networkId}:${vaultId}`, indexedResult.value);
      } else {
        setHistoryLoadError(
          indexedResult.reason instanceof Error
            ? indexedResult.reason.message
            : "Could not refresh complete history",
        );
      }
      if (inboxResult.status === "rejected") {
        console.warn("Could not refresh private inbox:", inboxResult.reason);
      }
    } finally {
      setIsLoadingIndexed(false);
      setIsRefreshingAll(false);
    }
  }, [fetchIndexedTransactions, isRefreshingAll, networkId, refresh, vaultId]);

  const items = useMemo<ActivityItem[]>(() => {
    const recoveredActivities = recoverSelfTransferActivities(
      displayNotes,
      submittedActivities,
      indexedTransactions,
      networkId,
    );
    const allSubmittedActivities = [...submittedActivities, ...recoveredActivities];
    // Private sends need explorer enrichment to determine whether they were
    // self-transfers and to merge their output notes. Other locally submitted
    // rows already contain authoritative amount and destination data.
    const displaySubmittedActivities = hasIndexedSnapshot
      ? allSubmittedActivities
      : allSubmittedActivities.filter((activity) => activity.kind !== "private_send");
    const submittedSignatures = new Set(
      displaySubmittedActivities.map((activity) => activity.signature),
    );
    const outputsBySignature: Record<string, string[]> = {};
    const inputsBySignature: Record<string, string[]> = {};
    for (const transaction of indexedTransactions) {
      if (!submittedSignatures.has(transaction.txSignature)) continue;
      outputsBySignature[transaction.txSignature] = transaction.outputs
        .map((output) => output.commitment?.toLowerCase())
        .filter((commitment): commitment is string => Boolean(commitment));
      inputsBySignature[transaction.txSignature] = transaction.inputs
        .map((input) => input.nullifierHash?.toLowerCase())
        .filter((nullifier): nullifier is string => Boolean(nullifier));
    }
    const originByCommitment = indexOwnedNoteOrigins(indexedTransactions);
    const preservedSourceCommitments = new Set(
      Object.entries(originByCommitment)
        .filter(([, origin]) => origin.kind === "btc_deposit" || origin.kind === "shield")
        .map(([commitment]) => commitment),
    );
    const { visibleNotes, enrichmentBySignature } = reconcileSubmittedActivity(
      displayNotes,
      displaySubmittedActivities,
      outputsBySignature,
      inputsBySignature,
      preservedSourceCommitments,
    );
    return [
      ...visibleNotes
        .map((note) => ({
          kind: "note" as const,
          id: note.id,
          createdAt: note.createdAt,
          note,
          origin: originByCommitment[note.commitmentHex.toLowerCase()],
        })),
      ...pendingActivities.map((activity) => ({
        kind: "pending-faucet" as const,
        id: activity.id,
        createdAt: activity.createdAt,
        activity,
      })),
      ...displaySubmittedActivities.map((activity) => ({
        kind: "submitted" as const,
        id: activity.id,
        createdAt: activity.createdAt,
        activity,
        outputCommitments: enrichmentBySignature[activity.signature]?.outputCommitments ?? [],
        isSelfTransfer: enrichmentBySignature[activity.signature]?.isSelfTransfer ?? false,
      })),
    ].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [displayNotes, hasIndexedSnapshot, indexedTransactions, networkId, pendingActivities, submittedActivities]);

  const filteredItems = useMemo(() => {
    const query = hashQuery.trim().toLowerCase();
    if (!query) return items;
    return items.filter((item) => {
      const annotation = annotations[annotationIdForActivity(item)];
      if (
        annotation?.label?.toLowerCase().includes(query)
        || annotation?.note?.toLowerCase().includes(query)
      ) {
        return true;
      }
      if (item.kind === "note") {
        return item.note.commitmentHex.toLowerCase().includes(query)
          || item.note.id.toLowerCase().includes(query);
      }
      if (item.kind === "pending-faucet") {
        return item.id.toLowerCase().includes(query)
          || item.activity.txid?.toLowerCase().includes(query);
      }
      return item.activity.signature.toLowerCase().includes(query)
        || item.activity.recipient?.toLowerCase().includes(query)
        || item.outputCommitments.some((commitment) => commitment.includes(query))
        || item.id.toLowerCase().includes(query);
    });
  }, [annotations, hashQuery, items]);

  // Sort by createdAt descending, then group by date
  const grouped = useMemo(() => {
    const groups: { date: string; items: ActivityItem[] }[] = [];
    for (const item of filteredItems) {
      const dateKey = formatDateKey(item.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.date === dateKey) {
        last.items.push(item);
      } else {
        groups.push({ date: dateKey, items: [item] });
      }
    }
    return groups;
  }, [filteredItems]);

  const isUpdatingHistory = isLoading || isLoadingIndexed || isRefreshingAll;
  const hasHistoryError = Boolean(historyLoadError || inboxError);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <div className="flex items-center gap-2 text-caption text-gray/50">
          <span>{filteredItems.length} transaction{filteredItems.length !== 1 ? "s" : ""}</span>
          {isUpdatingHistory && (
            <span className="inline-flex items-center gap-1 text-gray/40" role="status">
              <Loader2 className="h-3 w-3 animate-spin" />
              Updating…
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={refreshAllActivity}
          disabled={isUpdatingHistory}
          aria-label="Refresh all activity"
          className="flex items-center gap-1 px-2 py-1 rounded-[6px] text-caption text-gray hover:text-gray-light hover:bg-gray/10 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isUpdatingHistory && "animate-spin")} />
        </button>
      </div>

      <div>
        <label htmlFor="activity-hash-search" className="sr-only">
          Find activity by label, note, transaction hash or commitment
        </label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray/45" />
          <input
            id="activity-hash-search"
            type="search"
            value={hashQuery}
            onChange={(event) => setHashQuery(event.target.value)}
            placeholder="Label, note, transaction hash or commitment"
            autoComplete="off"
            spellCheck={false}
            className="h-10 w-full appearance-none rounded-lg border border-gray/15 bg-muted/35 pl-9 pr-9 font-mono text-xs text-foreground outline-none transition-colors placeholder:font-sans placeholder:text-gray/55 hover:border-gray/25 focus:border-privacy/45 focus:ring-2 focus:ring-privacy/10 [&::-webkit-search-cancel-button]:appearance-none"
          />
          {hashQuery && (
            <button
              type="button"
              onClick={() => setHashQuery("")}
              aria-label="Clear activity search"
              className="absolute right-1.5 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-gray/55 transition-colors hover:bg-gray/10 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-privacy/40"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {hasHistoryError && items.length > 0 && (
        <div className="flex items-center justify-between gap-3 rounded-[8px] border border-warning/15 bg-warning/5 px-3 py-2 text-xs">
          <span className="inline-flex items-center gap-1.5 text-warning/80">
            <AlertTriangle className="h-3.5 w-3.5 shrink-0" />
            Showing available activity. Some history could not be refreshed.
          </span>
          <button
            type="button"
            onClick={() => setHistoryRetry((value) => value + 1)}
            className="shrink-0 font-medium text-warning hover:text-warning/80"
          >
            Try again
          </button>
        </div>
      )}

      {items.length === 0 && isUpdatingHistory && <ActivityFeedSkeleton />}

      {items.length === 0 && !isUpdatingHistory && hasHistoryError && (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
          <AlertTriangle className="h-5 w-5 text-warning" />
          <div>
            <p className="text-sm text-foreground">Could not refresh activity</p>
            <p className="mt-1 text-xs text-muted-foreground">Your transaction data has not been changed.</p>
          </div>
          <button
            type="button"
            onClick={() => setHistoryRetry((value) => value + 1)}
            className="rounded-md bg-privacy/10 px-3 py-1.5 text-xs text-privacy hover:bg-privacy/15"
          >
            Try again
          </button>
        </div>
      )}

      {filteredItems.length === 0 && !isUpdatingHistory && !hasHistoryError && (
        <div className="text-center py-6">
          <img src="/brand/logo-transparent-96.png" alt="" className="w-8 h-8 object-contain opacity-30 mx-auto mb-2" />
          <p className="text-sm text-gray/50">{hashQuery.trim() ? "No matching activity" : "No activity yet"}</p>
          <p className="text-xs text-gray/30 mt-1">
            {hashQuery.trim()
              ? "Check the label, note, transaction hash or commitment and try again."
              : "Deposits and transfers will appear here"}
          </p>
        </div>
      )}

      {grouped.map(({ date, items: groupItems }) => (
        <div key={date}>
          <p className="text-xs text-gray/50 font-medium px-1 mb-1.5">{date}</p>
          <div className="rounded-[12px] border border-gray/10 overflow-hidden divide-y divide-gray/8">
            {groupItems.map((item) => (
              item.kind === "note"
                ? <ActivityRow
                    key={item.id}
                    note={item.note}
                    tokenPrices={tokenPrices}
                    origin={item.origin}
                    annotation={annotations[annotationIdForActivity(item)]}
                    onSaveAnnotation={(input) => updateAnnotation(annotationIdForActivity(item), input)}
                  />
                : item.kind === "pending-faucet"
                  ? <PendingFaucetRow
                      key={item.id}
                      activity={item.activity}
                      tokenPrices={tokenPrices}
                      annotation={annotations[annotationIdForActivity(item)]}
                      onSaveAnnotation={(input) => updateAnnotation(annotationIdForActivity(item), input)}
                      backendStatus={btcTxStatuses.get(item.activity.txid)}
                    />
                  : <SubmittedTransactionRow
                      key={item.id}
                      activity={item.activity}
                      tokenPrices={tokenPrices}
                      isSelfTransfer={item.isSelfTransfer}
                      annotation={annotations[annotationIdForActivity(item)]}
                      onSaveAnnotation={(input) => updateAnnotation(annotationIdForActivity(item), input)}
                    />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityFeedSkeleton() {
  return (
    <div className="space-y-2" aria-label="Loading activity" role="status">
      {[0, 1, 2].map((row) => (
        <div
          key={row}
          className="flex h-[58px] items-center gap-3 rounded-[10px] border border-gray/8 px-4 animate-pulse"
        >
          <div className="h-6 w-6 shrink-0 rounded-full bg-gray/10" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3 w-24 rounded bg-gray/10" />
            <div className="h-2.5 w-16 rounded bg-gray/8" />
          </div>
          <div className="space-y-1.5">
            <div className="ml-auto h-3 w-20 rounded bg-gray/10" />
            <div className="ml-auto h-2.5 w-14 rounded bg-gray/8" />
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityContent() {
  const { hasKeys, isLoading: keysLoading } = useUTXOpiaKeys();

  // Auth modal state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const { error: passkeyError } = usePasskey();
  const loadViewOnlyKeys = useUTXOpiaStore((s) => s.loadViewOnlyKeys);

  // Auto-open auth modal on mount when not logged in
  const autoOpenRef = useRef(false);
  useEffect(() => {
    if (!hasKeys && !autoOpenRef.current) {
      autoOpenRef.current = true;
      setAuthModalOpen(true);
    }
  }, [hasKeys]);

  return (
    <>
      {/* Show unlock screen when no keys */}
      {!hasKeys && (
        <>
          <EmptyInbox hasKeys={false} onUnlock={() => setAuthModalOpen(true)} isLoading={keysLoading} />
          <AuthModal
            open={authModalOpen}
            onOpenChange={setAuthModalOpen}
            auth={{
              error: passkeyError,
              onViewOnlyLogin: (viewingKey) => { void loadViewOnlyKeys(viewingKey); setAuthModalOpen(false); },
            }}
          />
        </>
      )}

      {/* Activity feed — only when keys available */}
      {hasKeys && (
        <ErrorBoundary>
          <ActivityFeed />
        </ErrorBoundary>
      )}
    </>
  );
}

export default function ActivityPage() {
  const { networkId } = useChainEnvironment();
  return (
    <main className="min-h-screen bg-background flex flex-col items-center py-8 px-4 sm:py-12">
      {/* Header — Back + Badges */}
      <div className="w-full mb-4 flex items-center justify-between relative z-10" style={{ maxWidth: "480px" }}>
        <Link
          href={hrefWithChain("/vault", networkId)}
          className="inline-flex items-center gap-2 text-body2 text-gray hover:text-gray-light transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full border bg-privacy/10 border-privacy/20">
            <History className="w-3 h-3 text-privacy" />
            <span className="text-caption text-privacy">Activity</span>
          </div>
          <div className="flex items-center gap-1.5 px-2 py-1 rounded-full border bg-privacy/10 border-privacy/20">
            <LockKeyhole className="w-3 h-3 text-privacy" />
            <span className="text-caption text-privacy">Private</span>
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col items-center pb-8">
        {/* Widget */}
        <div
          className={cn(
            "bg-card border border-solid border-gray/30 p-4",
            "w-[480px] max-w-[calc(100vw-32px)] rounded-[16px]"
          )}
        >
          {/* Title */}
          <div className="flex items-center gap-3 mb-4 pb-4 border-b border-gray/15">
            <div className="p-2 rounded-[10px] bg-privacy/10 border border-privacy/20">
              <History className="w-5 h-5 text-privacy" />
            </div>
            <div>
              <h1 className="text-heading6 text-foreground">Activity</h1>
              <p className="text-caption text-gray">
                Your private transaction history
              </p>
            </div>
          </div>

          {/* Content with Suspense */}
          <Suspense fallback={<div className="flex items-center justify-center py-8"><div className="w-6 h-6 border-2 border-privacy border-t-transparent rounded-full animate-spin" /></div>}>
            <ActivityContent />
          </Suspense>

          {/* Footer inside card */}
          <div className="flex flex-row justify-between items-center gap-2 mt-2 text-gray px-2 pt-2">
            <Link href={hrefWithChain("/docs", networkId)} className="hover:text-gray-light transition-colors text-caption">UTXOpia</Link>
          </div>
        </div>
      </div>
    </main>
  );
}
