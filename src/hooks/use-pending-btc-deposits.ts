"use client";

// BTC deposits take minutes to travel from broadcast to a spendable note
// (confirm → sweep → SPV → mint). Callers surface the in-flight count so the
// wallet does not look inert, and keep it out of the spendable balance.

import { useEffect, useMemo, useState } from "react";
import { getPendingFaucetActivities } from "@/lib/faucet-activity";
import type { NetworkConfig, NetworkId } from "@/lib/network-config";
import { useExplorer } from "@/hooks/use-explorer";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

/** Count of BTC deposits broadcast but not yet credited as spendable notes. */
export function usePendingBtcDeposits(networkId: NetworkId, config: NetworkConfig): number {
  const stealthAddress = useUTXOpiaStore((s) => s.stealthAddressEncoded);
  // Same feed the activity page reads, so a deposit clears the moment its note
  // is credited rather than lingering as a phantom amount.
  const { transactions } = useExplorer(networkId);
  const [count, setCount] = useState(0);

  // A string, not a Set: the transactions array is a fresh reference on every
  // render, and an object dependency would re-run the effect forever.
  const creditedKey = useMemo(
    () =>
      transactions
        .map((tx) => tx.btcMeta?.depositTxid)
        .filter((txid): txid is string => Boolean(txid))
        .sort()
        .join(","),
    [transactions],
  );

  useEffect(() => {
    const credited = new Set(creditedKey ? creditedKey.split(",") : []);
    const sync = () => {
      const next = getPendingFaucetActivities({
        networkId,
        stealthAddress,
        creditedBtcTxids: credited,
        currentPoolAddress: config.bitcoin.poolAddress,
      }).length;
      setCount((prev) => (prev === next ? prev : next));
    };
    sync();
    window.addEventListener("storage", sync);
    window.addEventListener("utxopia:faucet-activity", sync);
    return () => {
      window.removeEventListener("storage", sync);
      window.removeEventListener("utxopia:faucet-activity", sync);
    };
  }, [networkId, stealthAddress, creditedKey, config.bitcoin.poolAddress]);

  return count;
}
