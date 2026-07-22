"use client";

import type { InboxNote } from "@/stores/utxopia-store";

const STORAGE_KEY = "utxopia:faucet-activity:v1";
const MAX_AGE_MS = 60 * 60 * 1000;

export interface PendingFaucetActivity {
  id: string;
  networkId: string;
  stealthAddress: string;
  amountSats: number;
  txid: string;
  opReturn?: string;
  depositAddress?: string;
  blocksMined?: number;
  createdAt: number;
  updatedAt: number;
  status: "processing";
}

interface FaucetActivityLedger {
  pending: PendingFaucetActivity[];
}

export function isOutdatedFaucetPool(
  activity: Pick<PendingFaucetActivity, "depositAddress">,
  currentPoolAddress?: string,
): boolean {
  return Boolean(
    activity.depositAddress
      && currentPoolAddress
      && activity.depositAddress !== currentPoolAddress,
  );
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

function hasMatchingScannedNote(activity: PendingFaucetActivity, notes: InboxNote[]): boolean {
  const requestedAmount = BigInt(activity.amountSats);
  const feeTolerance = requestedAmount / 20n + 1_000n;
  return notes.some((note) => {
    if (note.tokenSymbol !== "zkBTC") return false;
    const creditedAmount = BigInt(note.amount ?? 0);
    if (creditedAmount > requestedAmount) return false;
    if (requestedAmount - creditedAmount > feeTolerance) return false;
    return note.createdAt >= activity.createdAt - 5 * 60 * 1000;
  });
}

export function recordPendingFaucetActivity(input: {
  networkId: string;
  stealthAddress: string;
  amountSats: number;
  txid: string;
  opReturn?: string;
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
    opReturn: input.opReturn,
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
  notes: InboxNote[];
  currentPoolAddress?: string;
}): PendingFaucetActivity[] {
  if (!input.stealthAddress) return [];
  const cutoff = Date.now() - MAX_AGE_MS;
  const ledger = readLedger();
  const live = ledger.pending.filter((activity) => {
    if (activity.updatedAt < cutoff) return false;
    if (activity.networkId !== input.networkId) return false;
    if (activity.stealthAddress !== input.stealthAddress) return false;
    if (isOutdatedFaucetPool(activity, input.currentPoolAddress)) return false;
    return !hasMatchingScannedNote(activity, input.notes);
  });
  if (live.length !== ledger.pending.length) {
    writeLedger({ pending: live });
  }
  return live.sort((a, b) => b.createdAt - a.createdAt);
}
