import { describe, expect, it } from "bun:test";
import { sumUnspentByToken } from "./use-sibling-vault-balances";
import { getVaultRuntimeConfig, siblingVaultId, vaultsSupported } from "@/lib/vault-config";

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
  it("covers every deployment that has both pools", () => {
    // Both run dual vaults, off separate programs and separate mints. Support
    // is membership in the vault table, so a network with no entry — and any
    // network added later without one — still answers false.
    expect(vaultsSupported("devnet-regtest")).toBe(true);
    expect(vaultsSupported("devnet")).toBe(true);
    expect(vaultsSupported("mainnet" as never)).toBe(false);
  });

  it("keeps the two deployments' vaults distinct", () => {
    // One cache serves both networks; keying it on the vault id alone would
    // hand whichever resolved first to the other network's users.
    for (const vault of ["open", "verified"] as const) {
      const hybrid = getVaultRuntimeConfig("devnet-regtest", vault);
      const testnet4 = getVaultRuntimeConfig("devnet", vault);
      expect(testnet4.programId).not.toBe(hybrid.programId);
      expect(testnet4.mint).not.toBe(hybrid.mint);
      expect(testnet4.poolState).not.toBe(hybrid.poolState);
      expect(testnet4.btcAddress).not.toBe(hybrid.btcAddress);
      expect(testnet4.ikaDwallet).not.toBe(hybrid.ikaDwallet);
    }
  });

  it("gives each vault on a deployment its own BTC custody", () => {
    // Sharing a dWallet between pools would give them one taproot address and
    // therefore one indistinguishable UTXO set.
    for (const network of ["devnet-regtest", "devnet"] as const) {
      const open = getVaultRuntimeConfig(network, "open");
      const verified = getVaultRuntimeConfig(network, "verified");
      expect(open.ikaDwallet).not.toBe(verified.ikaDwallet);
      expect(open.btcAddress).not.toBe(verified.btcAddress);
    }
  });
});
