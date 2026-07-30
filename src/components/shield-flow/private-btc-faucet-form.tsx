"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, CheckCircle2, Droplets } from "lucide-react";
import { hrefWithChain, type NetworkId } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { recordPendingFaucetActivity } from "@/lib/faucet-activity";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { cn } from "@/lib/utils";

type DripResult =
  | {
      kind: "ok";
      txid: string;
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
  depositAddress?: string;
  opReturn?: string;
  amountSats?: number;
  dailyLimit?: number;
  retryAfterSec?: number;
  error?: string;
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
  const { vaultId } = useChainEnvironment();
  const [amountSats, setAmountSats] = useState(100_000);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DripResult | null>(null);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const stealthAddress = useUTXOpiaStore((state) => state.stealthAddressEncoded);
  const privateBtcBalance = useUTXOpiaStore((state) => state.inboxBalancesByToken.zkBTC ?? 0n);

  useEffect(() => {
    setResult(null);
  }, [amountSats, stealthAddress]);

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

  const hasVault = Boolean(stealthAddress && /^utxo:[0-9a-fA-F]{192}$/.test(stealthAddress));

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
      const params = new URLSearchParams({ network, vault: vaultId });
      const response = await fetch(`/api/faucet/regtest?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stealthAddress, amountSats }),
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

      if (response.status === 429 && typeof body.retryAfterSec === "number") {
        setResult({
          kind: "cooldown",
          retryAfterSec: body.retryAfterSec,
          message: body.error ?? `Daily limit reached. Try again in ${formatCooldown(body.retryAfterSec)}.`,
        });
      } else if (!response.ok || !body.ok) {
        setResult({ kind: "err", message: body.error ?? `HTTP ${response.status}` });
      } else {
        recordPendingFaucetActivity({
          networkId: network,
          stealthAddress,
          amountSats: body.amountSats ?? amountSats,
          txid: body.txid ?? "",
          opReturn: body.opReturn,
          depositAddress: body.depositAddress,
          blocksMined: body.blocksMined,
        });
        setResult({
          kind: "ok",
          txid: body.txid ?? "",
          warning: body.warning,
          credited: false,
        });
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

  const cooldownActive = result?.kind === "cooldown" && cooldownLeft > 0;
  const disabled = !hasVault || submitting || amountSats <= 0 || cooldownActive;

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
          {(amountSats / 1e8).toFixed(8)} BTC. Limit: 3 deposits per day.
        </p>
      </div>

      {(!hasVault || cooldownActive) && (
        <div className="flex items-start gap-2 rounded-[10px] border border-warning/25 bg-warning/5 p-3 text-caption text-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {!hasVault ? (
              <>
                Open your vault once to initialize its private deposit identity.
                <Link
                  href={hrefWithChain("/vault", network)}
                  className="ml-1 font-semibold underline underline-offset-2"
                >
                  Open vault
                </Link>
              </>
            ) : (
              <>Cooldown active. Try again in {cooldownLeft}s.</>
            )}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={handleDrip}
        disabled={disabled}
        title={!hasVault ? "Initialize your private vault first" : undefined}
        className="btn-primary w-full"
      >
        <Droplets className="h-5 w-5" />
        {submitting
          ? "Creating Bitcoin transaction..."
          : cooldownActive
            ? `Try again in ${formatCooldown(cooldownLeft)}`
            : "Get private test BTC"}
      </button>

      {result?.kind === "ok" && (
        <div className="space-y-3 rounded-[10px] border border-success/30 bg-success/5 p-3 text-caption text-success">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold text-success">
                {result.credited ? "Private BTC balance updated" : "Bitcoin transaction confirmed"}
              </p>
              <p className="mt-0.5 text-success/75">
                {result.credited
                  ? "The funds are ready in your private balance."
                  : "Updating your private balance automatically. No second deposit is needed."}
              </p>
              {result.credited && (
                <p className="mt-1 font-mono text-success">
                  Private balance: {(Number(privateBtcBalance) / 1e8).toFixed(8)} BTC
                </p>
              )}
            </div>
          </div>
          <div className="break-all rounded-[8px] border border-success/10 bg-background/30 p-2 font-mono text-success/80">
            {result.txid || "(see backend log)"}
          </div>
          {result.warning && (
            <div className="border-t border-success/10 pt-1 text-warning">{result.warning}</div>
          )}
          <Link
            href={hrefWithChain("/vault/activity?refresh=inbox", network)}
            className="inline-flex min-h-11 items-center justify-center rounded-[8px] border border-success/25 px-3 text-[11px] font-semibold text-success transition-colors hover:bg-success/10"
          >
            View activity
          </Link>
        </div>
      )}

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
