/** @happy-dom */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import {
  alphaDemoLedgerEnabled,
  getAlphaDemoInboxNotes,
  getAlphaDemoNetworkInboxNotes,
  recordAlphaDemoDeposit,
} from "./alpha-demo-ledger";

const STORAGE_KEY = "utxopia:alpha-demo-ledger:v1";
const STEALTH_ADDRESS = `utxo:${"ab".repeat(96)}`;

describe("alpha demo ledger", () => {
  const originalDevSigner = process.env.NEXT_PUBLIC_DEV_SIGNER;
  const originalDisableDemo = process.env.NEXT_PUBLIC_DISABLE_ALPHA_DEMO_TX;

  beforeEach(() => {
    localStorage.clear();
    process.env.NEXT_PUBLIC_DEV_SIGNER = "1";
    delete process.env.NEXT_PUBLIC_DISABLE_ALPHA_DEMO_TX;
  });

  afterEach(() => {
    localStorage.clear();
    if (originalDevSigner === undefined) {
      delete process.env.NEXT_PUBLIC_DEV_SIGNER;
    } else {
      process.env.NEXT_PUBLIC_DEV_SIGNER = originalDevSigner;
    }
    if (originalDisableDemo === undefined) {
      delete process.env.NEXT_PUBLIC_DISABLE_ALPHA_DEMO_TX;
    } else {
      process.env.NEXT_PUBLIC_DISABLE_ALPHA_DEMO_TX = originalDisableDemo;
    }
  });

  it("turns a faucet demo deposit into an activity inbox note", () => {
    expect(alphaDemoLedgerEnabled("devnet-regtest")).toBe(true);

    recordAlphaDemoDeposit({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 25_000,
      txid: "faucet-tx-1",
      opReturn: `6a28${"00".repeat(40)}`,
    });

    const notes = getAlphaDemoInboxNotes("devnet-regtest", STEALTH_ADDRESS);

    expect(notes).toHaveLength(1);
    expect(notes[0].amount).toBe(25_000n);
    expect(notes[0].tokenSymbol).toBe("zkBTC");
    expect(notes[0].isSpent).toBe(false);
    expect(notes[0].id).toStartWith("alpha-demo-");
    expect(notes[0].commitmentHex).toHaveLength(64);
  });

  it("keeps faucet activity scoped to network and recipient address", () => {
    recordAlphaDemoDeposit({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 10_000,
      txid: "faucet-tx-2",
    });

    expect(getAlphaDemoInboxNotes("devnet-regtest", STEALTH_ADDRESS)).toHaveLength(1);
    expect(getAlphaDemoInboxNotes("devnet", STEALTH_ADDRESS)).toHaveLength(0);
    expect(getAlphaDemoInboxNotes("devnet-regtest", `utxo:${"cd".repeat(96)}`)).toHaveLength(0);
  });

  it("can recover locally recorded faucet notes by network", () => {
    recordAlphaDemoDeposit({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 10_000,
      txid: "faucet-tx-4",
    });

    const notes = getAlphaDemoNetworkInboxNotes("devnet-regtest");

    expect(notes).toHaveLength(1);
    expect(notes[0].amount).toBe(10_000n);
  });

  it("does not write demo faucet activity when real transactions are forced", () => {
    process.env.NEXT_PUBLIC_DISABLE_ALPHA_DEMO_TX = "1";

    recordAlphaDemoDeposit({
      networkId: "devnet-regtest",
      stealthAddress: STEALTH_ADDRESS,
      amountSats: 10_000,
      txid: "faucet-tx-3",
    });

    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(getAlphaDemoInboxNotes("devnet-regtest", STEALTH_ADDRESS)).toHaveLength(0);
  });
});
