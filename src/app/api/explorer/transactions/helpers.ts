export interface ExplorerTx {
  txSignature?: string;
  type?: string;
  tokenId?: string;
  tokenSymbol?: string | null;
  timestamp?: number;
  status?: string;
  btcMeta?: unknown;
  [key: string]: unknown;
}

function hasBtcMeta(tx: ExplorerTx): boolean {
  if (!tx.btcMeta || typeof tx.btcMeta !== "object") return false;
  return Object.values(tx.btcMeta as Record<string, unknown>).some((value) => value != null);
}

export function normalizeExplorerTransaction(tx: ExplorerTx): ExplorerTx {
  if (tx.type !== "shield") return tx;
  if (hasBtcMeta(tx)) return tx;
  if (tx.status === "sweeping" || tx.status === "sweep_confirming") {
    return { ...tx, status: tx.txSignature ? "confirmed" : "processing" };
  }
  return tx;
}
