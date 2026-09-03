"use client";

const STORAGE_KEY = "utxopia:faucet-activity:v1";
const MAX_AGE_MS = 60 * 60 * 1000;

export interface PendingFaucetActivity {
  id: string;
  networkId: string;
  stealthAddress: string;
  amountSats: number;
  txid: string;
  depositAddress?: string;
  blocksMined?: number;
  createdAt: number;
  updatedAt: number;
  status: "processing";
}

interface FaucetActivityLedger {
  pending: PendingFaucetActivity[];
}

function readLedger(): FaucetActivityLedger {
  if (typeof window === "undefined") return { pending: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<FaucetActivityLedger>;
    return { pending: Array.isArray(parsed.pending) ? parsed.pending : [] };
  } catch {
    return { pending: [] };
  }
}

function writeLedger(ledger: FaucetActivityLedger): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
    window.dispatchEvent(new CustomEvent("utxopia:faucet-activity"));
  } catch {
    // Local activity is best-effort only.
  }
}

export function recordPendingFaucetActivity(input: {
  networkId: string;
  stealthAddress: string;
  amountSats: number;
  txid: string;
  depositAddress?: string;
  blocksMined?: number;
}): void {
  const txid = input.txid || `local-${Date.now()}`;
  const id = `${input.networkId}:${input.stealthAddress}:${txid}`;
  const now = Date.now();
  const ledger = readLedger();
  const pending = ledger.pending.filter((activity) => activity.id !== id);
  pending.push({
    id,
    networkId: input.networkId,
    stealthAddress: input.stealthAddress,
    amountSats: Math.max(0, Math.trunc(input.amountSats)),
    txid,
    depositAddress: input.depositAddress,
    blocksMined: input.blocksMined,
    createdAt: now,
    updatedAt: now,
    status: "processing",
  });
  writeLedger({ pending: pending.slice(-20) });
}

export function getPendingFaucetActivities(input: {
  networkId: string;
  stealthAddress: string | null;
  /** BTC txids that the explorer has linked to a completed shield transaction. */
  creditedBtcTxids?: ReadonlySet<string>;
}): PendingFaucetActivity[] {
  if (!input.stealthAddress) return [];
  const cutoff = Date.now() - MAX_AGE_MS;
  const ledger = readLedger();
  const live = ledger.pending.filter((activity) => {
    if (activity.updatedAt < cutoff) return false;
    if (activity.networkId !== input.networkId) return false;
    if (activity.stealthAddress !== input.stealthAddress) return false;
    // depositAddress is per-deposit under the tweak scheme, so it says nothing
    // about which pool the coins went to. The old shared-pool-address check here
    // dropped every tweak deposit as "outdated" before it could be shown.
    // Only reconcile the pending and credited rows when both point to the
    // exact same Bitcoin transaction. Amount/time proximity is not identity.
    return !input.creditedBtcTxids?.has(activity.txid);
  });
  if (live.length !== ledger.pending.length) {
    writeLedger({ pending: live });
  }
  return live.sort((a, b) => b.createdAt - a.createdAt);
}
