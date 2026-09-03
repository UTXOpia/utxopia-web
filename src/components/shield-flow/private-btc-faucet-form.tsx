"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, Check, CheckCircle2, Copy, Droplets, ExternalLink, Loader2 } from "lucide-react";
import { hrefWithChain, type NetworkId } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { recordPendingFaucetActivity } from "@/lib/faucet-activity";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { useNotesStore } from "@/stores/notes-store";
import { getMempoolExplorerUrl } from "@/lib/btc-network";
import { deriveTweakDepositForFaucet, type TweakDepositRequest } from "@/lib/tweak-deposit";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { DepositStatusTracker } from "@/components/shield-flow/deposit-status-tracker";
import { VaultIdentityUnlock } from "@/components/vault/vault-identity-unlock";
import { cn } from "@/lib/utils";

type DripResult =
  | {
      kind: "ok";
      txid: string;
      depositAddress: string;
      amountSats: number;
      /** Local note id carrying the tracker's deposit id; null when the route did not return one. */
      noteId: string | null;
      warning?: string;
      credited?: boolean;
    }
  | { kind: "cooldown"; retryAfterSec: number; message: string }
  | { kind: "err"; message: string };

interface FaucetResponse {
  ok: boolean;
  txid?: string;
  blocksMined?: number;
  warning?: string;
  depositId?: string;
  depositAddress?: string;
  amountSats?: number;
  dailyLimit?: number;
  remaining?: number;
  retryAfterSec?: number;
  error?: string;
}

interface Quota {
  dailyLimit: number;
  remaining: number;
  resetAfterSec: number;
}

/** Whole-unit countdown: a raw second count reads as a broken button once the
 *  daily limit pushes the wait into the hours. */
function formatCooldown(seconds: number): string {
  if (seconds >= 3600) {
    const hours = Math.ceil(seconds / 3600);
    return `${hours}h`;
  }
  if (seconds >= 60) return `${Math.ceil(seconds / 60)}m`;
  return `${Math.max(seconds, 1)}s`;
}

export function PrivateBtcFaucetForm({ network }: { network: NetworkId }) {
  const { vaultId, config: networkConfig } = useChainEnvironment();
  const [amountSats, setAmountSats] = useState(100_000);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DripResult | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [quota, setQuota] = useState<Quota | null>(null);
  // The address shown before sending. Peeked, not claimed: looking never burns an index.
  const [preview, setPreview] = useState<TweakDepositRequest | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [previewKey, setPreviewKey] = useState(0);
  const { copied, copy } = useCopyToClipboard();
  const stealthAddress = useUTXOpiaStore((state) => state.stealthAddressEncoded);
  const privateBtcBalance = useUTXOpiaStore((state) => state.inboxBalancesByToken.zkBTC ?? 0n);

  const hasVault = Boolean(stealthAddress && /^utxo:[0-9a-fA-F]{192}$/.test(stealthAddress));

  useEffect(() => {
    setResult((current) => (current?.kind === "ok" ? current : null));
  }, [amountSats, stealthAddress]);

  useEffect(() => {
    if (!hasVault || !stealthAddress) {
      setPreview(null);
      return;
    }
    let cancelled = false;
    setPreviewError(null);
    deriveTweakDepositForFaucet(networkConfig, stealthAddress, "peek")
      .then((next) => { if (!cancelled) setPreview(next); })
      .catch((cause) => {
        if (cancelled) return;
        setPreview(null);
        setPreviewError(cause instanceof Error ? cause.message : String(cause));
      });
    return () => { cancelled = true; };
  }, [hasVault, networkConfig, stealthAddress, previewKey]);

  // Ask up front how many drips are left, so an exhausted allowance disables the
  // button instead of being discovered by spending a click on a 429.
  const refreshQuota = useCallback(async () => {
    if (!stealthAddress) {
      setQuota(null);
      return;
    }
    const params = new URLSearchParams({ network, vault: vaultId, stealthAddress });
    try {
      const response = await fetch(`/api/faucet/regtest?${params.toString()}`, { cache: "no-store" });
      if (!response.ok) return;
      const body = (await response.json()) as Partial<Quota>;
      if (typeof body.remaining !== "number" || typeof body.dailyLimit !== "number") return;
      setQuota({
        dailyLimit: body.dailyLimit,
        remaining: body.remaining,
        resetAfterSec: body.resetAfterSec ?? 0,
      });
    } catch {
      // Quota is advisory — the route still enforces it on POST.
    }
  }, [network, vaultId, stealthAddress]);

  useEffect(() => {
    void refreshQuota();
  }, [refreshQuota]);

  useEffect(() => {
    if (result?.kind !== "cooldown") {
      setCooldownLeft(0);
      return;
    }

    setCooldownLeft(result.retryAfterSec);
    const interval = setInterval(() => {
      setCooldownLeft((seconds) => (seconds > 0 ? seconds - 1 : 0));
    }, 1000);
    return () => clearInterval(interval);
  }, [result]);

  async function mineMissingConfirmations(blocksAlreadyMined?: number): Promise<void> {
    const blocks = Math.max(0, 6 - Math.max(0, Number(blocksAlreadyMined ?? 0)));
    if (blocks === 0) return;

    try {
      await fetch(`/api/regtest/mine?network=${encodeURIComponent(network)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      });
    } catch (cause) {
      console.warn("[Faucet] Follow-up regtest mining failed:", cause);
    }
  }

  async function refreshUntilCredited(previousBalance: bigint): Promise<void> {
    for (let attempt = 0; attempt < 18; attempt += 1) {
      try {
        await useUTXOpiaStore.getState().refreshInbox(undefined, true);
        const currentBalance = useUTXOpiaStore.getState().inboxBalancesByToken.zkBTC ?? 0n;
        if (currentBalance > previousBalance) {
          setResult((current) => current?.kind === "ok" ? { ...current, credited: true } : current);
          return;
        }
      } catch (cause) {
        console.warn("[Faucet] Private balance refresh failed:", cause);
      }
      if (attempt < 17) await new Promise((resolve) => setTimeout(resolve, 5_000));
    }
  }

  async function handleDrip() {
    if (!stealthAddress) return;

    const previousBalance = privateBtcBalance;
    setSubmitting(true);
    setResult(null);

    try {
      // Claim the index now. Normally this is the address previewed above; if
      // another tab claimed it first, the paid address is the one shown after.
      const tweak = await deriveTweakDepositForFaucet(networkConfig, stealthAddress);

      const params = new URLSearchParams({ network, vault: vaultId });
      const response = await fetch(`/api/faucet/regtest?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stealthAddress, amountSats, ...tweak }),
      });
      const text = await response.text();
      let body: FaucetResponse;

      try {
        body = JSON.parse(text) as FaucetResponse;
      } catch {
        throw new Error(
          `BTC faucet returned an invalid response (HTTP ${response.status}). Check Activity before trying again.`,
        );
      }

      if (typeof body.remaining === "number") {
        setQuota((current) => ({
          dailyLimit: body.dailyLimit ?? current?.dailyLimit ?? 3,
          remaining: body.remaining!,
          resetAfterSec: body.retryAfterSec ?? current?.resetAfterSec ?? 0,
        }));
      }

      if (response.status === 429 && typeof body.retryAfterSec === "number") {
        setResult({
          kind: "cooldown",
          retryAfterSec: body.retryAfterSec,
          message: body.error ?? `Daily limit reached. Try again in ${formatCooldown(body.retryAfterSec)}.`,
        });
      } else if (!response.ok || !body.ok) {
        setResult({ kind: "err", message: body.error ?? `HTTP ${response.status}` });
      } else {
        const paidAmount = body.amountSats ?? amountSats;
        const depositAddress = body.depositAddress ?? tweak.depositAddress;
        recordPendingFaucetActivity({
          networkId: network,
          stealthAddress,
          amountSats: paidAmount,
          txid: body.txid ?? "",
          depositAddress,
          blocksMined: body.blocksMined,
        });
        // Same note the manual deposit path saves: it is what the status tracker
        // reads the deposit id from.
        const noteId = body.depositId
          ? useNotesStore.getState().saveNote({
              commitment: tweak.notePublicKey,
              noteExport: "",
              amountSats: paidAmount,
              taprootAddress: depositAddress,
              depositId: body.depositId,
              expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
            })
          : null;
        setResult({
          kind: "ok",
          txid: body.txid ?? "",
          depositAddress,
          amountSats: paidAmount,
          noteId,
          warning: body.warning,
          credited: false,
        });
        void refreshQuota();
        void mineMissingConfirmations(body.blocksMined).finally(() => {
          void refreshUntilCredited(previousBalance);
        });
      }
    } catch (cause) {
      setResult({
        kind: "err",
        message: cause instanceof Error ? cause.message : "Could not get private test BTC.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  function reset() {
    setResult(null);
    // The paid address is spent; the next peek shows the one after it.
    setPreviewKey((key) => key + 1);
  }

  const cooldownActive = result?.kind === "cooldown" && cooldownLeft > 0;
  const exhausted = quota?.remaining === 0;
  const disabled = !hasVault || submitting || amountSats <= 0 || cooldownActive || exhausted || !preview;

  // Page 2: sent. Nothing to check again — show what was paid, where it stands, and when it lands.
  if (result?.kind === "ok") {
    return (
      <div className="space-y-4 py-2 text-center">
        <div className="inline-flex rounded-full border border-btc/20 bg-btc/10 p-3">
          {result.credited
            ? <CheckCircle2 className="h-8 w-8 text-btc" />
            : <Loader2 className="h-8 w-8 animate-spin text-btc" />}
        </div>
        <h3 className="text-lg font-semibold text-foreground">
          {result.credited ? "Private BTC balance updated" : "Test BTC sent"}
        </h3>
        <p className="text-caption text-gray">
          {result.credited
            ? `${(Number(privateBtcBalance) / 1e8).toFixed(8)} BTC is ready in your private balance.`
            : "Confirming on regtest and crediting your private balance. No second deposit is needed."}
        </p>

        <div className="space-y-3 rounded-[12px] border border-btc/20 bg-btc/5 p-4 text-left">
          <div>
            <p className="mb-1 pl-1 text-[10px] uppercase tracking-wider text-gray">
              {result.amountSats.toLocaleString()} sats paid to
            </p>
            <div className="break-all rounded-[8px] border border-gray/15 bg-background/40 p-2 font-mono text-caption text-foreground">
              {result.depositAddress}
            </div>
          </div>
          <div>
            <p className="mb-1 pl-1 text-[10px] uppercase tracking-wider text-gray">Bitcoin transaction</p>
            <div className="break-all rounded-[8px] border border-gray/15 bg-background/40 p-2 font-mono text-caption text-foreground">
              {result.txid || "(see backend log)"}
            </div>
          </div>
          {result.noteId
            ? <DepositStatusTracker noteId={result.noteId} showRefresh />
            : !result.credited && (
              <div className="flex items-center justify-center gap-2 text-caption text-gray">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                <span>Updating private balance…</span>
              </div>
            )}
          {result.warning && (
            <div className="border-t border-gray/10 pt-2 text-caption text-warning">{result.warning}</div>
          )}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-3">
          {result.txid && (
            <a
              href={`${getMempoolExplorerUrl(network)}/tx/${result.txid}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-caption text-btc transition-colors hover:text-btc/80"
            >
              View on explorer <ExternalLink className="h-3 w-3" />
            </a>
          )}
          <Link
            href={hrefWithChain("/vault/activity?refresh=inbox", network)}
            className="inline-flex items-center gap-1.5 text-caption text-gray transition-colors hover:text-foreground"
          >
            View activity
          </Link>
        </div>
        <div className="pt-1">
          <button
            type="button"
            onClick={reset}
            className="cursor-pointer rounded-[10px] border border-gray/15 bg-muted px-5 py-2 text-body2 text-gray-light transition-colors hover:bg-muted/80 hover:text-foreground"
          >
            Get more
          </button>
        </div>
      </div>
    );
  }

  // Page 1: what will be paid, and where.
  return (
    <div className="space-y-4">
      <div>
        <label className="mb-2 block pl-2 text-body2 text-gray-light">
          Private recipient
        </label>
        <div
          className="w-full rounded-[12px] border border-gray/15 bg-muted p-3 font-mono text-body2 text-foreground"
          title={stealthAddress ?? undefined}
        >
          {stealthAddress
            ? `${stealthAddress.slice(0, 18)}…${stealthAddress.slice(-12)}`
            : "Not initialized"}
        </div>
        <p className="mt-1 pl-2 text-caption text-gray">
          Test BTC is sent to this private address automatically.
        </p>
      </div>

      <div>
        <label htmlFor="private-btc-faucet-amount" className="mb-2 block pl-2 text-body2 text-gray-light">
          Amount (sats)
        </label>
        <input
          id="private-btc-faucet-amount"
          type="number"
          min={1}
          max={100_000}
          step={1000}
          value={amountSats}
          onChange={(event) => setAmountSats(Number(event.target.value) || 0)}
          className={cn(
            "w-full rounded-[12px] border border-gray/15 bg-muted p-3",
            "font-mono text-body2 text-foreground",
            "outline-none transition-colors focus:border-warning/40",
          )}
        />
        <p className="mt-1 pl-2 text-caption text-gray">
          {(amountSats / 1e8).toFixed(8)} BTC.{" "}
          {quota
            ? exhausted
              ? `No deposits left today — resets in ${formatCooldown(quota.resetAfterSec)}.`
              : `${quota.remaining} of ${quota.dailyLimit} deposits left today.`
            : "Limit: 3 deposits per day."}
        </p>
      </div>

      {hasVault && (
        <div>
          <label className="mb-2 block pl-2 text-body2 text-gray-light">
            Deposit address
          </label>
          {preview ? (
            <button
              type="button"
              onClick={() => copy(preview.depositAddress)}
              className="flex w-full items-start gap-2 rounded-[12px] border border-btc/20 bg-btc/5 p-3 text-left font-mono text-caption text-foreground transition-colors hover:border-btc/40"
            >
              <span className="min-w-0 flex-1 break-all">{preview.depositAddress}</span>
              {copied
                ? <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
                : <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray" />}
            </button>
          ) : previewError ? (
            <div className="rounded-[10px] border border-error/30 bg-error/5 p-3 text-caption text-error">
              {previewError}
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-[12px] border border-gray/15 bg-muted p-3 text-caption text-gray">
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
              Deriving address…
            </div>
          )}
          <p className="mt-1 pl-2 text-caption text-gray">
            Derived by this browser and used once. The payment carries no metadata —
            the address itself binds it to your private balance.
          </p>
        </div>
      )}

      {/* Unlock here rather than sending them to /vault and back. The old copy
          named the cause correctly and then made it someone else's page. */}
      {!hasVault && <VaultIdentityUnlock />}

      {hasVault && cooldownActive && (
        <div className="flex items-start gap-2 rounded-[10px] border border-warning/25 bg-warning/5 p-3 text-caption text-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>Cooldown active. Try again in {cooldownLeft}s.</div>
        </div>
      )}

      <button
        type="button"
        onClick={handleDrip}
        disabled={disabled}
        title={!hasVault ? "Initialize your private vault first" : undefined}
        className="btn-primary w-full"
      >
        {submitting ? <Loader2 className="h-5 w-5 animate-spin" /> : <Droplets className="h-5 w-5" />}
        {submitting
          ? "Sending test BTC..."
          : cooldownActive
            ? `Try again in ${formatCooldown(cooldownLeft)}`
            : exhausted
              ? `Daily limit reached — resets in ${formatCooldown(quota?.resetAfterSec ?? 0)}`
              : "Get private test BTC"}
      </button>

      {result?.kind === "cooldown" && (
        <div className="rounded-[10px] border border-warning/30 bg-warning/5 p-3 text-caption text-warning">
          {cooldownLeft > 0
            ? `Cooldown active. Try again in ${cooldownLeft}s.`
            : "Cooldown cleared. Try again."}
        </div>
      )}

      {result?.kind === "err" && (
        <div className="rounded-[10px] border border-error/30 bg-error/5 p-3 text-caption text-error">
          {result.message}
        </div>
      )}

      <p className="text-caption text-gray">
        The Bitcoin transaction is routed through the current Ika vault and credited to your private balance.
      </p>
    </div>
  );
}
