"use client";

import { useState, useMemo, useEffect, useRef, Suspense } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { ErrorBoundary } from "@/components/error-boundary";
import { useUTXOpiaKeys, useStealthInbox } from "@/hooks/use-utxopia";
import { usePasskey } from "@/hooks/use-passkey";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { AuthModal } from "@/components/auth-modal";
import { EmptyInbox } from "@/components/stealth-inbox";

import { SUPPORTED_TOKENS, getTokenBySymbol, type SupportedToken } from "@/lib/supported-tokens";
import { useTokenPrices } from "@/hooks/use-token-prices";
import type { InboxNote } from "@/stores/utxopia-store";
import { hrefWithChain } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { Tooltip } from "@/components/ui/tooltip";
import { getPendingFaucetActivities, type PendingFaucetActivity } from "@/lib/faucet-activity";
import { getAlphaDemoNetworkInboxNotes } from "@/lib/alpha-demo-ledger";
import {
  getSubmittedTransactions,
  type SubmittedTransactionActivity,
} from "@/lib/transaction-activity";
import { getChainTransactionUrl } from "@/lib/chain-links";

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

function ActivityRow({ note }: { note: InboxNote }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { networkId: network } = useChainEnvironment();
  const tokenPrices = useTokenPrices();
  const token = getToken(note.tokenSymbol);
  const price = tokenPrices[token.priceKey];
  const usdValue = price ? (Number(note.amount) / 10 ** token.decimals) * price : 0;
  const isReceived = !note.isSpent;

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
          <span className="text-sm text-foreground font-medium">
            {isReceived ? "Received" : "Sent"}
          </span>
          <p className="text-[11px] text-gray/40">{timeAgo(note.createdAt)}</p>
        </div>

        {/* Amount + token */}
        <div className="text-right shrink-0">
          <p className={cn(
            "text-sm font-semibold font-mono tabular-nums",
            isReceived ? "text-privacy" : "text-gray"
          )}>
            {isReceived ? "+" : "-"}{formatAmt(note.amount, token)}{" "}
            <span className="text-xs font-medium">{token.shieldedSymbol}</span>
          </p>
          {usdValue > 0 && (
            <p className="text-[11px] text-gray/45 font-mono tabular-nums">
              ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </p>
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
                    ${usdValue.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                  </span>
                )}
              </div>
            </div>

            {/* Info rows */}
            <div className="px-3.5 py-2 space-y-1.5 text-xs">
              <div className="flex justify-between">
                <span className="text-gray/40">Type</span>
                <span className="text-foreground/80">{isReceived ? "Funds received" : "Private send"}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray/40">Time</span>
                <span className="text-gray/60">{formatFullDate(note.createdAt)}</span>
              </div>
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

            {/* Footer — explorer link */}
            <div className="px-3.5 py-2 border-t border-gray/8">
              <Link
                href={hrefWithChain("/explorer", network)}
                className="inline-flex items-center gap-1.5 text-[11px] text-privacy hover:text-privacy/80 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
                View in Explorer
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PendingFaucetRow({ activity }: { activity: PendingFaucetActivity }) {
  const [expanded, setExpanded] = useState(false);
  const { networkId: network } = useChainEnvironment();
  const token = getToken("zkBTC");

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
          <span className="text-sm text-foreground font-medium">Faucet deposit</span>
          <p className="text-[11px] text-warning/75">Processing / {timeAgo(activity.createdAt)}</p>
        </div>

        <div className="text-right shrink-0">
          <p className="text-sm font-semibold font-mono tabular-nums text-warning">
            +{formatAmt(activity.amountSats, token)}{" "}
            <span className="text-xs font-medium">{token.shieldedSymbol}</span>
          </p>
          <p className="text-[11px] text-gray/45">
            waiting for vault credit
          </p>
        </div>
      </div>

      {expanded && (
        <div className="mx-4 mb-3">
          <div className="rounded-[10px] bg-linear-to-b from-warning/8 to-transparent border border-warning/15 overflow-hidden">
            <div className="px-3.5 py-2.5 border-b border-warning/10 bg-warning/5">
              <div className="flex items-center gap-2">
                <Loader2 className="h-4 w-4 text-warning animate-spin" />
                <span className="text-sm font-semibold text-warning">Processing on testnet</span>
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

            <div className="px-3.5 py-2 border-t border-warning/10">
              <Link
                href={hrefWithChain("/explorer", network)}
                className="inline-flex items-center gap-1.5 text-[11px] text-warning hover:text-warning/80 transition-colors"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="w-3 h-3" />
                Check Explorer
              </Link>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const SUBMITTED_LABELS: Record<SubmittedTransactionActivity["kind"], { label: string; status: string }> = {
  private_send: { label: "Private transfer", status: "Relay confirmed" },
  claim_link: { label: "Claim link funded", status: "Relay confirmed" },
  cashout_btc: { label: "Bitcoin withdrawal", status: "Request confirmed on-chain" },
  cashout_wallet: { label: "Wallet withdrawal", status: "Relay confirmed" },
};

function SubmittedTransactionRow({ activity }: { activity: SubmittedTransactionActivity }) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const { networkId, config } = useChainEnvironment();
  const token = getToken(activity.tokenSymbol);
  const meta = SUBMITTED_LABELS[activity.kind];

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
        <div className="w-6 h-6 rounded-full flex items-center justify-center shrink-0 bg-success/10">
          <Check className="w-3.5 h-3.5 text-success" />
        </div>
        <div className="flex-1 min-w-0">
          <span className="text-sm text-foreground font-medium">{meta.label}</span>
          <p className="text-[11px] text-success/75">Submitted / {timeAgo(activity.createdAt)}</p>
        </div>
        <div className="text-right shrink-0">
          <p className="text-sm font-semibold font-mono tabular-nums text-gray">
            -{formatAmt(BigInt(activity.amountBaseUnits), token)}{" "}
            <span className="text-xs font-medium">{token.shieldedSymbol}</span>
          </p>
          <p className="hidden sm:block text-[11px] text-gray/45">{meta.status}</p>
        </div>
      </div>

      {expanded && (
        <div className="mx-4 mb-3 rounded-[10px] border border-success/15 bg-success/4 overflow-hidden">
          <div className="px-3.5 py-2 space-y-1.5 text-xs">
            <div className="flex justify-between gap-3">
              <span className="text-gray/40">Status</span>
              <span className="text-success text-right">{meta.status}</span>
            </div>
            <div className="flex justify-between gap-3">
              <span className="text-gray/40">Time</span>
              <span className="text-gray/60 text-right">{formatFullDate(activity.createdAt)}</span>
            </div>
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
  | { kind: "note"; id: string; createdAt: number; note: InboxNote }
  | { kind: "pending-faucet"; id: string; createdAt: number; activity: PendingFaucetActivity }
  | { kind: "submitted"; id: string; createdAt: number; activity: SubmittedTransactionActivity };

function ActivityFeed() {
  const { notes, isLoading, refresh } = useStealthInbox();
  const searchParams = useSearchParams();
  const forcedRefreshRef = useRef(false);
  const { networkId } = useChainEnvironment();
  const stealthAddress = useUTXOpiaStore((s) => s.stealthAddressEncoded);
  const [pendingActivities, setPendingActivities] = useState<PendingFaucetActivity[]>([]);
  const [submittedActivities, setSubmittedActivities] = useState<SubmittedTransactionActivity[]>([]);
  const alphaDemoNotes = useMemo(() => {
    const scoped = getAlphaDemoNetworkInboxNotes(networkId, stealthAddress);
    return scoped.length > 0 ? scoped : getAlphaDemoNetworkInboxNotes(networkId);
  }, [networkId, stealthAddress]);
  const displayNotes = useMemo(() => {
    const byId = new Map<string, InboxNote>();
    for (const note of notes) byId.set(note.id, note);
    for (const note of alphaDemoNotes) byId.set(note.id, note);
    return Array.from(byId.values());
  }, [alphaDemoNotes, notes]);

  useEffect(() => {
    if (forcedRefreshRef.current || searchParams.get("refresh") !== "inbox") return;
    forcedRefreshRef.current = true;
    refresh(undefined, true);
  }, [refresh, searchParams]);

  useEffect(() => {
    const sync = () => {
      setPendingActivities(getPendingFaucetActivities({ networkId, stealthAddress, notes: displayNotes }));
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("utxopia:faucet-activity", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("utxopia:faucet-activity", sync);
    };
  }, [displayNotes, networkId, stealthAddress]);

  useEffect(() => {
    const sync = () => setSubmittedActivities(getSubmittedTransactions(networkId));
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("utxopia:transaction-activity", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("utxopia:transaction-activity", sync);
    };
  }, [networkId]);

  const items = useMemo<ActivityItem[]>(() => {
    return [
      ...displayNotes.map((note) => ({ kind: "note" as const, id: note.id, createdAt: note.createdAt, note })),
      ...pendingActivities.map((activity) => ({
        kind: "pending-faucet" as const,
        id: activity.id,
        createdAt: activity.createdAt,
        activity,
      })),
      ...submittedActivities.map((activity) => ({
        kind: "submitted" as const,
        id: activity.id,
        createdAt: activity.createdAt,
        activity,
      })),
    ].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  }, [displayNotes, pendingActivities, submittedActivities]);

  // Sort by createdAt descending, then group by date
  const grouped = useMemo(() => {
    const groups: { date: string; items: ActivityItem[] }[] = [];
    for (const item of items) {
      const dateKey = formatDateKey(item.createdAt);
      const last = groups[groups.length - 1];
      if (last && last.date === dateKey) {
        last.items.push(item);
      } else {
        groups.push({ date: dateKey, items: [item] });
      }
    }
    return groups;
  }, [items]);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between px-1">
        <span className="text-caption text-gray/50">{items.length} transaction{items.length !== 1 ? "s" : ""}</span>
        <button
          onClick={refresh}
          disabled={isLoading}
          className="flex items-center gap-1 px-2 py-1 rounded-[6px] text-caption text-gray hover:text-gray-light hover:bg-gray/10 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={cn("w-3.5 h-3.5", isLoading && "animate-spin")} />
        </button>
      </div>

      {isLoading && items.length === 0 && (
        <div className="flex items-center justify-center py-6">
          <div className="w-6 h-6 border-2 border-privacy border-t-transparent rounded-full animate-spin" />
        </div>
      )}

      {items.length === 0 && !isLoading && (
        <div className="text-center py-6">
          <img src="/brand/logo-transparent-96.png" alt="" className="w-8 h-8 object-contain opacity-30 mx-auto mb-2" />
          <p className="text-sm text-gray/50">No activity yet</p>
          <p className="text-xs text-gray/30 mt-1">Deposits and transfers will appear here</p>
        </div>
      )}

      {grouped.map(({ date, items: groupItems }) => (
        <div key={date}>
          <p className="text-xs text-gray/50 font-medium px-1 mb-1.5">{date}</p>
          <div className="rounded-[12px] border border-gray/10 overflow-hidden divide-y divide-gray/8">
            {groupItems.map((item) => (
              item.kind === "note"
                ? <ActivityRow key={item.id} note={item.note} />
                : item.kind === "pending-faucet"
                  ? <PendingFaucetRow key={item.id} activity={item.activity} />
                  : <SubmittedTransactionRow key={item.id} activity={item.activity} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function ActivityContent() {
  const { hasKeys, isLoading: keysLoading, deriveKeys } = useUTXOpiaKeys();

  // Auth modal state
  const [authModalOpen, setAuthModalOpen] = useState(false);
  const { connected } = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const {
    isSupported: passkeySupported,
    hasCredential: hasPasskeyCredential,
    isLoading: passkeyLoading,
    error: passkeyError,
    register: passkeyRegister,
    authenticate: passkeyAuthenticate,
  } = usePasskey();
  const deriveKeysFromPasskeySeed = useUTXOpiaStore((s) => s.deriveKeysFromPasskeySeed);
  const loadViewOnlyKeys = useUTXOpiaStore((s) => s.loadViewOnlyKeys);

  const handlePasskeyRegister = async () => {
    const seed = await passkeyRegister();
    if (seed) {
      await deriveKeysFromPasskeySeed(seed);
      setAuthModalOpen(false);
    }
  };
  const handlePasskeyAuthenticate = async () => {
    const seed = await passkeyAuthenticate();
    if (seed) {
      await deriveKeysFromPasskeySeed(seed);
      setAuthModalOpen(false);
    }
  };

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
              passkeySupported,
              hasPasskeyCredential,
              passkeyLoading,
              walletLoading: keysLoading,
              walletConnected: connected,
              error: passkeyError,
              onPasskeyRegister: handlePasskeyRegister,
              onPasskeyAuthenticate: handlePasskeyAuthenticate,
              onWalletConnect: () => { setAuthModalOpen(false); setWalletModalVisible(true); },
              onWalletDeriveKeys: async () => { await deriveKeys(); setAuthModalOpen(false); },
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
