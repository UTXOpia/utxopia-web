import { describe, expect, it } from "bun:test";
import {
  getProductTransactionLabel,
  PRODUCT_COPY,
  PRODUCT_FEATURES,
  PRODUCT_TERMS,
} from "./product-language";

describe("product language", () => {
  it("uses one public label for each transaction type", () => {
    expect(getProductTransactionLabel("shield")).toBe(PRODUCT_COPY.transactions.shield);
    expect(getProductTransactionLabel("shield", { isBtcDeposit: true })).toBe(
      PRODUCT_COPY.transactions.btcDeposit,
    );
    expect(getProductTransactionLabel("transfer")).toBe(
      PRODUCT_COPY.transactions.privateTransfer,
    );
    expect(getProductTransactionLabel("unshield")).toBe(
      PRODUCT_COPY.transactions.cashOut,
    );
    expect(getProductTransactionLabel("withdraw")).toBe(
      PRODUCT_COPY.transactions.withdrawBtc,
    );
  });

  it("keeps protocol implementation names out of primary feature copy", () => {
    expect(JSON.stringify(PRODUCT_FEATURES)).not.toMatch(/\b(?:unshield|redeem)\b/i);
  });

  it("defines every canonical transaction label exactly once", () => {
    const terms = PRODUCT_TERMS.map((item) => item.term);
    const transactionTerms = Object.values(PRODUCT_COPY.transactions);

    for (const term of transactionTerms) {
      expect(terms.filter((item) => item === term)).toHaveLength(1);
    }
    expect(new Set(terms).size).toBe(terms.length);
  });
});
