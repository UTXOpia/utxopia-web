/** @happy-dom */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { getPendingFaucetActivities, recordPendingFaucetActivity } from "./faucet-activity";
import type { InboxNote } from "@/stores/utxopia-store";

const STEALTH_ADDRESS = `utxo:${"ab".repeat(96)}`;

function makeNote(amount: bigint, createdAt = Date.now()): InboxNote {
  const commitment = new Uint8Array(32).fill(7);
  return {
    amount,
    ephemeralPub: new Uint8Array(32),
    leafIndex: 1,
    commitment,
    id: "note-1",
    createdAt,
    commitmentHex: "07".repeat(32),
    isSpent: false,
    tokenSymbol: "zkBTC",
  };
}

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
      notes: [],
    })).toHaveLength(1);
    expect(getPendingFaucetActivities({
      networkId: "testnet",
      stealthAddress: STEALTH_ADDRESS,
      notes: [],
    })).toHaveLength(0);
    expect(getPendingFaucetActivities({
      networkId: "devnet-regtest",
      stealthAddress: `utxo:${"cd".repeat(96)}`,
      notes: [],
    })).toHaveLength(0);
  });

  it("removes pending faucet activity once a matching zkBTC note is scanned", () => {
    const before = Date.now();
    recordPendingFaucetActivity({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 50_000,
      txid: "btc-tx-2",
    });

    const pending = getPendingFaucetActivities({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      notes: [makeNote(50_000n, before + 1000)],
    });

    expect(pending).toHaveLength(0);
  });

  it("reconciles a faucet credit after the deposit service fee", () => {
    const before = Date.now();
    recordPendingFaucetActivity({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 100_000,
      txid: "btc-tx-net-credit",
    });

    const pending = getPendingFaucetActivities({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      notes: [makeNote(99_300n, before + 1000)],
    });

    expect(pending).toHaveLength(0);
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
      notes: [makeNote(25_000n)],
    });

    expect(pending).toHaveLength(1);
  });
});
