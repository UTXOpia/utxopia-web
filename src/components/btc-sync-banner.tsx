"use client";

import { useEffect, useState } from "react";
import { AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChainEnvironment } from "@/lib/chain-environment";

/** Shape of GET /api/btc/status. Every field is optional because the endpoint
 *  reports a reachable light client even when Bitcoin is unreachable, and vice
 *  versa — which side is broken is the thing worth knowing. */
interface BtcStatus {
  enabled: boolean;
  tip_height?: number;
  finalized_height?: number;
  btc_tip?: number | null;
  blocks_behind?: number | null;
  synced?: boolean | null;
  error?: string;
}

/**
 * Warns when the BTC light client is too far behind Bitcoin to prove a deposit.
 *
 * Deliberately renders nothing while things are healthy. A permanent "synced"
 * badge becomes furniture nobody reads; this is only on screen when a deposit
 * made right now would not credit.
 */
/** "testnet4" reads better than "Bitcoin" when three chains are selectable and
 *  only one of them is behind. */
const CHAIN_LABEL: Record<string, string> = {
  mainnet: "Bitcoin",
  testnet4: "Bitcoin testnet4",
  testnet: "Bitcoin testnet",
  signet: "Bitcoin signet",
  regtest: "Bitcoin regtest",
};

export function BtcSyncBanner({ className }: { className?: string }) {
  const { config } = useChainEnvironment();
  const [status, setStatus] = useState<BtcStatus | null>(null);
  const chain = CHAIN_LABEL[config.bitcoin.network] ?? "Bitcoin";

  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch("/api/btc/status", { cache: "no-store" });
        if (!res.ok) return;
        const body = (await res.json()) as BtcStatus;
        if (alive) setStatus(body);
      } catch {
        // A failed status check is not itself worth alarming the user about.
      }
    };
    load();
    const id = setInterval(load, 60_000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  if (!status?.enabled) return null;
  if (status.synced !== false && !status.error) return null;

  const behind = status.blocks_behind;

  return (
    <div
      role="alert"
      className={cn(
        "flex items-start gap-3 rounded-[12px] border border-warning/20 bg-warning/5 p-4",
        className,
      )}
    >
      <div className="mt-0.5 rounded-[9px] bg-warning/10 p-2">
        <AlertTriangle className="h-4 w-4 text-warning" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-body2-semibold text-foreground">
          {chain} sync is behind
        </p>
        <p className="mt-1 text-caption text-gray">
          {status.error
            ? `The ${chain} light client could not be read: ${status.error}`
            : `The on-chain light client is at block ${status.tip_height?.toLocaleString()}, ` +
              `${behind?.toLocaleString()} behind ${chain}${
                status.btc_tip ? ` (${status.btc_tip.toLocaleString()})` : ""
              }. A deposit made now will confirm on Bitcoin but cannot be credited ` +
              `until the gap closes.`}
        </p>
      </div>
    </div>
  );
}
