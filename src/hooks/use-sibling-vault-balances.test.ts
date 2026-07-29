import { describe, expect, it } from "bun:test";
import { sumUnspentByToken } from "./use-sibling-vault-balances";
import { siblingVaultId, vaultsSupported } from "@/lib/vault-config";

describe("sumUnspentByToken", () => {
  it("sums unspent amounts per token and skips spent notes", () => {
    const balances = sumUnspentByToken([
      { tokenSymbol: "zkBTC", amount: 100n, isSpent: false },
      { tokenSymbol: "zkBTC", amount: 50n, isSpent: true },
      { tokenSymbol: "zkBTC", amount: 25n, isSpent: false },
      { tokenSymbol: "zkUSDC", amount: 7, isSpent: false },
    ]);
    expect(balances.zkBTC).toBe(125n);
    expect(balances.zkUSDC).toBe(7n);
  });

  it("returns an empty record for no notes", () => {
    expect(sumUnspentByToken([])).toEqual({});
  });
});

describe("siblingVaultId", () => {
  it("maps open ↔ verified", () => {
    expect(siblingVaultId("open")).toBe("verified");
    expect(siblingVaultId("verified")).toBe("open");
  });
});

describe("vaultsSupported", () => {
  it("is true only on devnet networks", () => {
    expect(vaultsSupported("devnet")).toBe(true);
    expect(vaultsSupported("devnet-regtest")).toBe(true);
    expect(vaultsSupported("mainnet" as never)).toBe(false);
  });
});
