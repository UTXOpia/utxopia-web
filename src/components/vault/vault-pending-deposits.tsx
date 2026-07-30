"use client";

// BTC deposits take minutes to travel from broadcast to a spendable note
// (confirm → sweep → SPV → mint). Without a marker the wallet looks like the
// deposit never happened. This shows the in-flight amount, deliberately kept
// out of the spendable balance above it.

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ChevronRight, Loader2 } from "lucide-react";
import { getPendingFaucetActivities, type PendingFaucetActivity } from "@/lib/faucet-activity";
import { hrefWithChain, type NetworkConfig, type NetworkId } from "@/lib/network-config";
import { useExplorer } from "@/hooks/use-explorer";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

export function VaultPendingDeposits({
  networkId,
  config,
}: {
  networkId: NetworkId;
  config: NetworkConfig;
}) {
  const stealthAddress = useUTXOpiaStore((s) => s.stealthAddressEncoded);
  // Same feed the activity page reads, so a deposit clears from "pending" the
  // moment its note is credited rather than lingering as a phantom amount.
  const { transactions } = useExplorer(networkId);
  const [pending, setPending] = useState<PendingFaucetActivity[]>([]);

  const creditedBtcTxids = useMemo(
    () =>
      new Set(
        transactions.flatMap((tx) => (tx.btcMeta?.depositTxid ? [tx.btcMeta.depositTxid] : [])),
      ),
    [transactions],
  );

  useEffect(() => {
    const sync = () =>
      setPending(
        getPendingFaucetActivities({
          networkId,
          stealthAddress,
          creditedBtcTxids,
          currentPoolAddress: config.bitcoin.poolAddress,
        }),
      );
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("utxopia:faucet-activity", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("utxopia:faucet-activity", sync);
    };
  }, [networkId, stealthAddress, creditedBtcTxids, config.bitcoin.poolAddress]);

  if (pending.length === 0) return null;

  const totalSats = pending.reduce((sum, activity) => sum + activity.amountSats, 0);
  const btc = (totalSats / 1e8).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 8,
  });

  return (
    <Link
      href={hrefWithChain("/vault/activity", networkId)}
      className="mb-3 flex items-center gap-2.5 rounded-[12px] border border-gray/15 bg-muted/30 px-4 py-2 transition-colors hover:bg-muted/50"
    >
      <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-privacy" />
      {/* "Arriving" carries the not-yet-spendable meaning on its own; the
          amount stays out of the balance above, which is the real safeguard. */}
      <p className="min-w-0 flex-1 text-[12px] text-foreground">
        <span className="font-mono">{btc} BTC</span> arriving
        {pending.length > 1 && (
          <span className="text-gray/50"> · {pending.length} deposits</span>
        )}
      </p>
      <ChevronRight className="h-3 w-3 shrink-0 text-gray/40" />
    </Link>
  );
}
