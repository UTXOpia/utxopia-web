/** @happy-dom */
import { beforeEach, describe, expect, it } from "bun:test";
import { getSubmittedTransactions, recordSubmittedTransaction } from "./transaction-activity";

describe("submitted transaction activity", () => {
  beforeEach(() => localStorage.clear());

  it("records only relay-confirmed transactions for the matching network", () => {
    recordSubmittedTransaction({
      networkId: "devnet-regtest",
      kind: "private_send",
      amountBaseUnits: 10_000n,
      tokenSymbol: "zkBTC",
      signature: "solana-signature",
      recipient: "alice.utxopia.sol",
    });

    expect(getSubmittedTransactions("devnet-regtest")).toMatchObject([
      { kind: "private_send", amountBaseUnits: "10000", signature: "solana-signature" },
    ]);
    expect(getSubmittedTransactions("sui-regtest")).toHaveLength(0);
  });

  it("does not create a receipt without a relay signature", () => {
    recordSubmittedTransaction({
      networkId: "devnet-regtest",
      kind: "cashout_btc",
      amountBaseUnits: 5_000n,
      tokenSymbol: "zkBTC",
      signature: "",
    });

    expect(getSubmittedTransactions("devnet-regtest")).toHaveLength(0);
  });

  it("ignores malformed local storage records", () => {
    localStorage.setItem("utxopia:submitted-transactions:v1", JSON.stringify({
      submitted: [{ signature: "partial" }, { amountBaseUnits: "not-a-number" }],
    }));

    expect(getSubmittedTransactions("devnet-regtest")).toHaveLength(0);
  });
});
