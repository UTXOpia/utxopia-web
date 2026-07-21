import type { Connection, SignatureStatus } from "@solana/web3.js";

const DEFAULT_TIMEOUT_MS = 60_000;
const DEFAULT_POLL_INTERVAL_MS = 1_000;

export interface ConfirmSignatureOptions {
  timeoutMs?: number;
  pollIntervalMs?: number;
}

function isConfirmed(status: SignatureStatus): boolean {
  return status.confirmationStatus === "confirmed"
    || status.confirmationStatus === "finalized"
    || status.confirmations === null;
}

/**
 * Confirm a submitted signature through HTTP status polling.
 *
 * Wallet adapters commonly use websocket confirmation internally, which can
 * time out even after a transaction has landed. Polling the signature status
 * makes the submitted signature the source of truth and avoids reporting a
 * successful transaction as failed.
 */
export async function confirmSubmittedSignature(
  connection: Pick<Connection, "getSignatureStatuses">,
  signature: string,
  options: ConfirmSignatureOptions = {},
): Promise<void> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const pollIntervalMs = options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS;
  const deadline = Date.now() + timeoutMs;
  let lastRpcError: unknown;

  do {
    try {
      const response = await connection.getSignatureStatuses(
        [signature],
        { searchTransactionHistory: true },
      );
      const status = response.value[0];
      if (status?.err) {
        throw new Error(`Transaction failed: ${JSON.stringify(status.err)}`);
      }
      if (status && isConfirmed(status)) return;
      lastRpcError = undefined;
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("Transaction failed:")) {
        throw error;
      }
      lastRpcError = error;
    }

    if (Date.now() >= deadline) break;
    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs));
  } while (Date.now() < deadline);

  const rpcDetail = lastRpcError instanceof Error ? ` Last RPC error: ${lastRpcError.message}` : "";
  throw new Error(
    `Transaction was submitted but confirmation is still pending. Check signature ${signature} in the explorer.${rpcDetail}`,
  );
}
