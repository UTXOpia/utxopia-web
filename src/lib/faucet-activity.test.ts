/** @happy-dom */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  getPendingFaucetActivities,
  recordPendingFaucetActivity,
} from "./faucet-activity";

const STEALTH_ADDRESS = `utxo:${"ab".repeat(96)}`;

describe("faucet activity", () => {
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

  it("keeps a tweak deposit whose per-deposit address differs from the pool address", () => {
    recordPendingFaucetActivity({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 100_000,
      txid: "btc-tx-tweak",
      depositAddress: "bcrt1pqxme9z463udgpegavmgfewjw4lc38gymurqjmryfdh2d2j2v97qs5zfxgg",
    });

    expect(getPendingFaucetActivities({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
    })).toHaveLength(1);
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
