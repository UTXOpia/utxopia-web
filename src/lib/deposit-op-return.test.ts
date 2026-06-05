import { describe, expect, it } from "bun:test";
import { depositOpReturnContextForNetworkConfig } from "./deposit-op-return";
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

  it("builds Sui regtest metadata from the active network config", () => {
    const context = depositOpReturnContextForNetworkConfig(
      getNetworkConfig("sui-regtest", { applyEnvOverrides: false }),
    );

    expect(context.destinationChain).toBe(2);
    expect(context.bitcoinNetwork).toBe(3);
    expect(context.poolTag).toHaveLength(8);
  });

  it("uses different deployment tags for Solana and Sui deposits", () => {
    const solana = depositOpReturnContextForNetworkConfig(
      getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }),
    );
    const sui = depositOpReturnContextForNetworkConfig(
      getNetworkConfig("sui-regtest", { applyEnvOverrides: false }),
    );

    expect(Buffer.from(solana.poolTag).equals(Buffer.from(sui.poolTag))).toBe(false);
  });
});
