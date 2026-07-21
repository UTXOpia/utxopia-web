import { describe, expect, it } from "bun:test";
import {
  buildDepositOpReturn,
  DEPOSIT_BITCOIN_NETWORK,
  DEPOSIT_DESTINATION_CHAIN,
} from "@utxopia/sdk";
import {
  depositAddressNetworkForNetworkConfig,
  depositOpReturnContextForNetworkConfig,
  parseDepositOpReturnHex,
} from "./deposit-op-return";
import { getNetworkConfig } from "./network-config";

describe("deposit OP_RETURN context", () => {
  it("builds Solana regtest metadata from the active network config", () => {
    const context = depositOpReturnContextForNetworkConfig(
      getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }),
    );

    expect(context.destinationChain).toBe(1);
    expect(context.bitcoinNetwork).toBe(3);
    expect(context.poolTag).toHaveLength(8);
  });

  it("parses SDK-built deposit OP_RETURN payloads", () => {
    const ephemeralPubkey = new Uint8Array(32).fill(0x11);
    const notePublicKey = new Uint8Array(32).fill(0x22);
    const payload = buildDepositOpReturn(ephemeralPubkey, notePublicKey, {
      destinationChain: DEPOSIT_DESTINATION_CHAIN.SOLANA,
      bitcoinNetwork: DEPOSIT_BITCOIN_NETWORK.REGTEST,
      poolTag: new Uint8Array(8).fill(0x33),
    });

    expect(parseDepositOpReturnHex(bytesToHex(payload))).toEqual({
      ephemeralPubkeyHex: "11".repeat(32),
      notePublicKeyHex: "22".repeat(32),
    });
  });

  it("maps active Bitcoin networks to address derivation networks", () => {
    expect(depositAddressNetworkForNetworkConfig(
      getNetworkConfig("devnet", { applyEnvOverrides: false }),
    )).toBe("testnet");
    expect(depositAddressNetworkForNetworkConfig(
      getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }),
    )).toBe("regtest");
  });
});

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
