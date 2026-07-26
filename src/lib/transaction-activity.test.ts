/** @happy-dom */
import { beforeEach, describe, expect, it } from "bun:test";
import {
  getSubmittedActivityDisplaySymbol,
  getSubmittedTransactions,
  recordSubmittedTransaction,
} from "./transaction-activity";

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
    expect(getSubmittedTransactions("testnet")).toHaveLength(0);
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

  it("keeps Open and Verified activity separate", () => {
    recordSubmittedTransaction({
      networkId: "devnet-regtest",
      vaultId: "verified",
      kind: "private_send",
      amountBaseUnits: 42n,
      tokenSymbol: "zkBTC",
      signature: "verified-signature",
    });

    expect(getSubmittedTransactions("devnet-regtest", "open")).toHaveLength(0);
    expect(getSubmittedTransactions("devnet-regtest", "verified")).toMatchObject([
      { signature: "verified-signature", vaultId: "verified" },
    ]);
  });

  it("ignores malformed local storage records", () => {
    localStorage.setItem("utxopia:submitted-transactions:v1", JSON.stringify({
      submitted: [{ signature: "partial" }, { amountBaseUnits: "not-a-number" }],
    }));

    expect(getSubmittedTransactions("devnet-regtest")).toHaveLength(0);
  });

  it("labels Bitcoin cash-outs as BTC and Solana wallet withdrawals as zkBTC", () => {
    expect(getSubmittedActivityDisplaySymbol("cashout_btc", "zkBTC")).toBe("BTC");
    expect(getSubmittedActivityDisplaySymbol("cashout_wallet", "zkBTC")).toBe("zkBTC");
    expect(getSubmittedActivityDisplaySymbol("cashout_wallet", "zkSOL")).toBe("SOL");
  });
});
