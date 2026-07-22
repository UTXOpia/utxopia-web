import { describe, expect, it } from "bun:test";
import { normalizeExplorerTransaction } from "./helpers";

describe("normalizeExplorerTransaction", () => {
  it("removes BTC sweep wording from confirmed non-BTC shield rows", () => {
    const tx = normalizeExplorerTransaction({
      txSignature: "sol-shield-sig",
      type: "shield",
      tokenSymbol: "SOL",
      status: "sweeping",
      btcMeta: null,
    });

    expect(tx.status).toBe("confirmed");
  });

  it("keeps BTC shield sweep lifecycle statuses when BTC metadata is present", () => {
    const tx = normalizeExplorerTransaction({
      type: "shield",
      status: "sweeping",
      btcMeta: { depositTxid: "btc-deposit-txid" },
    });

    expect(tx.status).toBe("sweeping");
  });

  it("normalizes legacy unshield rows with BTC outputs to withdraw", () => {
    const tx = normalizeExplorerTransaction({
      txSignature: "redeem-request-signature",
      type: "unshield",
      outputs: [{ type: "commitment" }, { type: "withdraw", btcTxid: "btc-txid" }],
    });

    expect(tx.type).toBe("withdraw");
  });
});
