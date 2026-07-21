"use client";

const STORAGE_KEY = "utxopia:submitted-transactions:v1";
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

export type SubmittedTransactionKind =
  | "private_send"
  | "claim_link"
  | "claim_receive"
  | "cashout_btc"
  | "cashout_wallet";

export interface SubmittedTransactionActivity {
  id: string;
  networkId: string;
  kind: SubmittedTransactionKind;
  amountBaseUnits: string;
  netAmountBaseUnits?: string;
  protocolFeeBaseUnits?: string;
  relayerFeeBaseUnits?: string;
  tokenSymbol: string;
  signature: string;
  recipient?: string;
  createdAt: number;
}

/** The public asset the recipient receives for each withdrawal route. */
export function getSubmittedActivityDisplaySymbol(
  kind: SubmittedTransactionKind,
  shieldedSymbol: string,
): string {
  if (kind === "cashout_btc") return "BTC";
  if (kind === "cashout_wallet" && shieldedSymbol === "zkSOL") return "SOL";
  return shieldedSymbol;
}

interface TransactionActivityLedger {
  submitted: SubmittedTransactionActivity[];
}

function isSubmittedTransaction(value: unknown): value is SubmittedTransactionActivity {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<SubmittedTransactionActivity>;
  if (
    typeof item.id !== "string" ||
    typeof item.networkId !== "string" ||
    typeof item.kind !== "string" ||
    typeof item.amountBaseUnits !== "string" ||
    typeof item.tokenSymbol !== "string" ||
    typeof item.signature !== "string" ||
    !item.signature ||
    typeof item.createdAt !== "number" ||
    !Number.isFinite(item.createdAt)
  ) return false;
  try {
    BigInt(item.amountBaseUnits);
    return true;
  } catch {
    return false;
  }
}

function readLedger(): TransactionActivityLedger {
  if (typeof window === "undefined") return { submitted: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<TransactionActivityLedger>;
    return {
      submitted: Array.isArray(parsed.submitted)
        ? parsed.submitted.filter(isSubmittedTransaction)
        : [],
    };
  } catch {
    return { submitted: [] };
  }
}

function writeLedger(ledger: TransactionActivityLedger): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
    window.dispatchEvent(new CustomEvent("utxopia:transaction-activity"));
  } catch {
    // A relay signature remains the source of truth if local persistence fails.
  }
}

export function recordSubmittedTransaction(input: {
  networkId: string;
  kind: SubmittedTransactionKind;
  amountBaseUnits: bigint;
  netAmountBaseUnits?: bigint;
  protocolFeeBaseUnits?: bigint;
  relayerFeeBaseUnits?: bigint;
  tokenSymbol: string;
  signature: string;
  recipient?: string;
}): void {
  if (!input.signature) return;
  const ledger = readLedger();
  const submitted = ledger.submitted.filter((item) => item.signature !== input.signature);
  submitted.push({
    id: `${input.networkId}:${input.signature}`,
    networkId: input.networkId,
    kind: input.kind,
    amountBaseUnits: input.amountBaseUnits.toString(),
    netAmountBaseUnits: input.netAmountBaseUnits?.toString(),
    protocolFeeBaseUnits: input.protocolFeeBaseUnits?.toString(),
    relayerFeeBaseUnits: input.relayerFeeBaseUnits?.toString(),
    tokenSymbol: input.tokenSymbol,
    signature: input.signature,
    recipient: input.recipient,
    createdAt: Date.now(),
  });
  writeLedger({ submitted: submitted.slice(-50) });
}

export function getSubmittedTransactions(networkId: string): SubmittedTransactionActivity[] {
  const cutoff = Date.now() - MAX_AGE_MS;
  const ledger = readLedger();
  const live = ledger.submitted.filter((item) => item.createdAt >= cutoff);
  if (live.length !== ledger.submitted.length) writeLedger({ submitted: live });
  return live
    .filter((item) => item.networkId === networkId)
    .sort((a, b) => b.createdAt - a.createdAt);
}
