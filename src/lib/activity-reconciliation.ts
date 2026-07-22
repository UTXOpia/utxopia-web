import type { SubmittedTransactionActivity } from "@/lib/transaction-activity";

interface ActivityNoteLike {
  commitmentHex: string;
  nullifierHash?: string;
}

export interface IndexedPrivateTransaction {
  txSignature: string;
  timestamp: number;
  type?: string;
  inputs: Array<{ nullifierHash?: string; btcDepositTxid?: string }>;
  outputs: Array<{ commitment?: string }>;
  btcDepositTxid?: string;
}

export type OwnedNoteOriginKind = "btc_deposit" | "shield" | "transfer";

export interface OwnedNoteOrigin {
  kind: OwnedNoteOriginKind;
  txSignature: string;
}

/** Attach an output note to the public transaction that created it. */
export function indexOwnedNoteOrigins(
  transactions: IndexedPrivateTransaction[],
): Record<string, OwnedNoteOrigin> {
  const origins: Record<string, OwnedNoteOrigin> = {};
  for (const transaction of transactions) {
    if (!transaction.txSignature) continue;
    const kind: OwnedNoteOriginKind = transaction.type === "shield"
      ? transaction.btcDepositTxid || transaction.inputs.some((input) => input.btcDepositTxid)
        ? "btc_deposit"
        : "shield"
      : "transfer";
    for (const output of transaction.outputs) {
      if (!output.commitment) continue;
      origins[output.commitment.toLowerCase()] = {
        kind,
        txSignature: transaction.txSignature,
      };
    }
  }
  return origins;
}

export interface SubmittedActivityEnrichment {
  outputCommitments: string[];
  isSelfTransfer: boolean;
}

export function reconcileSubmittedActivity<T extends ActivityNoteLike>(
  notes: T[],
  submitted: SubmittedTransactionActivity[],
  outputsBySignature: Record<string, string[]>,
  inputsBySignature: Record<string, string[]> = {},
): {
  visibleNotes: T[];
  enrichmentBySignature: Record<string, SubmittedActivityEnrichment>;
} {
  const ownedCommitments = new Set(notes.map((note) => note.commitmentHex.toLowerCase()));
  const submittedSignatures = new Set(submitted.map((activity) => activity.signature));
  const submittedOutputCommitments = new Set(
    Object.entries(outputsBySignature)
      .filter(([signature]) => submittedSignatures.has(signature))
      .flatMap(([, commitments]) => commitments)
      .map((commitment) => commitment.toLowerCase()),
  );
  const submittedInputNullifiers = new Set(
    Object.entries(inputsBySignature)
      .filter(([signature]) => submittedSignatures.has(signature))
      .flatMap(([, nullifiers]) => nullifiers)
      .map((nullifier) => nullifier.toLowerCase()),
  );
  const enrichmentBySignature: Record<string, SubmittedActivityEnrichment> = {};

  for (const activity of submitted) {
    const outputCommitments = (outputsBySignature[activity.signature] ?? [])
      .map((commitment) => commitment.toLowerCase());
    enrichmentBySignature[activity.signature] = {
      outputCommitments,
      isSelfTransfer:
        activity.kind === "private_send"
        && Boolean(outputCommitments[0])
        && ownedCommitments.has(outputCommitments[0]),
    };
  }

  return {
    visibleNotes: notes.filter(
      (note) => !submittedOutputCommitments.has(note.commitmentHex.toLowerCase())
        && !(
          note.nullifierHash
          && submittedInputNullifiers.has(note.nullifierHash.toLowerCase())
        ),
    ),
    enrichmentBySignature,
  };
}

/** Rebuild self-transfers even when the browser-local submitted ledger is unavailable. */
export function recoverSelfTransferActivities<T extends ActivityNoteLike & {
  tokenSymbol: string;
}>(
  notes: T[],
  submitted: SubmittedTransactionActivity[],
  transactions: IndexedPrivateTransaction[],
  networkId: string,
): SubmittedTransactionActivity[] {
  const noteByCommitment = new Map(
    notes.map((note) => [note.commitmentHex.toLowerCase(), note]),
  );
  const ownedNullifiers = new Set(
    notes.flatMap((note) => note.nullifierHash ? [note.nullifierHash.toLowerCase()] : []),
  );
  const submittedSignatures = new Set(submitted.map((activity) => activity.signature));

  return transactions.flatMap((transaction) => {
    if (
      !transaction.txSignature
      || submittedSignatures.has(transaction.txSignature)
      || (transaction.type && transaction.type !== "transfer")
    ) return [];

    const firstCommitment = transaction.outputs[0]?.commitment?.toLowerCase();
    const recipientNote = firstCommitment ? noteByCommitment.get(firstCommitment) : undefined;
    const spendsOwnedNote = transaction.inputs.some((input) =>
      input.nullifierHash
        ? ownedNullifiers.has(input.nullifierHash.toLowerCase())
        : false
    );
    if (!recipientNote || !spendsOwnedNote) return [];

    return [{
      id: `${networkId}:recovered:${transaction.txSignature}`,
      networkId,
      kind: "private_send" as const,
      amountBaseUnits: "0",
      tokenSymbol: recipientNote.tokenSymbol,
      signature: transaction.txSignature,
      createdAt: transaction.timestamp * 1000,
    }];
  });
}
