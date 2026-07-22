/** @happy-dom */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getPendingFaucetActivities,
  isOutdatedFaucetPool,
  recordPendingFaucetActivity,
} from "./faucet-activity";

const STEALTH_ADDRESS = `utxo:${"ab".repeat(96)}`;

describe("faucet activity", () => {
  it("detects a faucet transaction sent to an outdated pool", () => {
    expect(isOutdatedFaucetPool({ depositAddress: "bcrt1pold" }, "bcrt1pcurrent")).toBe(true);
    expect(isOutdatedFaucetPool({ depositAddress: "bcrt1pcurrent" }, "bcrt1pcurrent")).toBe(false);
  });
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    localStorage.clear();
  });

  it("records pending faucet activity for the matching network and stealth address", () => {
    recordPendingFaucetActivity({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 100_000,
      txid: "btc-tx-1",
      blocksMined: 6,
    });

    expect(getPendingFaucetActivities({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
    })).toHaveLength(1);
    expect(getPendingFaucetActivities({
      networkId: "testnet",
      stealthAddress: STEALTH_ADDRESS,
    })).toHaveLength(0);
    expect(getPendingFaucetActivities({
      networkId: "devnet-regtest",
      stealthAddress: `utxo:${"cd".repeat(96)}`,
    })).toHaveLength(0);
  });

  it("silently removes activity recorded for a previous pool configuration", () => {
    recordPendingFaucetActivity({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 100_000,
      txid: "btc-tx-old-pool",
      depositAddress: "bcrt1pold",
    });

    expect(getPendingFaucetActivities({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      currentPoolAddress: "bcrt1pcurrent",
    })).toHaveLength(0);
  });

  it("removes pending faucet activity only when the credited BTC txid matches", () => {
    recordPendingFaucetActivity({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 50_000,
      txid: "btc-tx-2",
    });

    const pending = getPendingFaucetActivities({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      creditedBtcTxids: new Set(["btc-tx-2"]),
    });

    expect(pending).toHaveLength(0);
  });

  it("does not merge a different transaction with the same expected amount", () => {
    recordPendingFaucetActivity({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 100_000,
      txid: "btc-tx-net-credit",
    });

    const pending = getPendingFaucetActivities({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      creditedBtcTxids: new Set(["another-btc-tx"]),
    });

    expect(pending).toHaveLength(1);
  });

  it("keeps pending faucet activity when scanned notes do not match", () => {
    recordPendingFaucetActivity({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 50_000,
      txid: "btc-tx-3",
    });

    const pending = getPendingFaucetActivities({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      creditedBtcTxids: new Set(),
    });

    expect(pending).toHaveLength(1);
  });
});
