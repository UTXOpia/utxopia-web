import { describe, expect, it } from "bun:test";
import { reconcileSubmittedActivity, recoverSelfTransferActivities } from "./activity-reconciliation";
import type { SubmittedTransactionActivity } from "./transaction-activity";

const activity: SubmittedTransactionActivity = {
  id: "devnet:signature",
  networkId: "devnet-regtest",
  kind: "private_send",
  amountBaseUnits: "100000",
  tokenSymbol: "zkBTC",
  signature: "signature",
  createdAt: 1,
};

describe("reconcileSubmittedActivity", () => {
  it("collapses a private transfer to self into the submitted row", () => {
    const result = reconcileSubmittedActivity(
      [
        { commitmentHex: "input", nullifierHash: "spent" },
        { commitmentHex: "recipient" },
        { commitmentHex: "change" },
      ],
      [activity],
      { signature: ["recipient", "fee", "change"] },
      { signature: ["spent"] },
    );

    expect(result.visibleNotes).toEqual([]);
    expect(result.enrichmentBySignature.signature).toEqual({
      outputCommitments: ["recipient", "fee", "change"],
      isSelfTransfer: true,
    });
  });

  it("recovers a self-transfer from owned inputs and the first owned output", () => {
    const result = recoverSelfTransferActivities(
      [
        { commitmentHex: "old", nullifierHash: "spent", tokenSymbol: "zkBTC" },
        { commitmentHex: "recipient", tokenSymbol: "zkBTC" },
      ],
      [],
      [{
        txSignature: "historical-signature",
        timestamp: 123,
        type: "transfer",
        inputs: [{ nullifierHash: "spent" }],
        outputs: [{ commitment: "recipient" }, { commitment: "change" }],
      }],
      "devnet-regtest",
    );

    expect(result).toEqual([{
      id: "devnet-regtest:recovered:historical-signature",
      networkId: "devnet-regtest",
      kind: "private_send",
      amountBaseUnits: "0",
      tokenSymbol: "zkBTC",
      signature: "historical-signature",
      createdAt: 123000,
    }]);
  });

  it("hides change without marking a transfer to another recipient as self", () => {
    const result = reconcileSubmittedActivity(
      [{ commitmentHex: "change" }],
      [activity],
      { signature: ["recipient", "fee", "change"] },
    );

    expect(result.visibleNotes).toEqual([]);
    expect(result.enrichmentBySignature.signature.isSelfTransfer).toBe(false);
  });

  it("does not hide notes from unrelated indexed transactions", () => {
    const result = reconcileSubmittedActivity(
      [{ commitmentHex: "recipient" }, { commitmentHex: "unrelated" }],
      [activity],
      { signature: ["recipient"], other: ["unrelated"] },
    );

    expect(result.visibleNotes).toEqual([{ commitmentHex: "unrelated" }]);
  });
});
