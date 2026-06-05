import { describe, expect, it } from "bun:test";
import {
  getChainTransactionUrl,
  getSuiExplorerNetwork,
  getSuiObjectUrl,
  getSuiTransactionUrl,
} from "./chain-links";
import { getNetworkConfig } from "./network-config";

describe("chain explorer links", () => {
  it("maps Sui app networks to the Sui Explorer network parameter", () => {
    expect(getSuiExplorerNetwork("sui-testnet")).toBe("testnet");
    expect(getSuiExplorerNetwork("sui-regtest")).toBe("testnet");
  });

  it("builds Sui object and transaction URLs from the active app network", () => {
    expect(getSuiObjectUrl("https://suiexplorer.com/", "0xabc", "sui-regtest")).toBe(
      "https://suiexplorer.com/object/0xabc?network=testnet",
    );
    expect(getSuiTransactionUrl("https://suiexplorer.com", "digest", "sui-regtest")).toBe(
      "https://suiexplorer.com/txblock/digest?network=testnet",
    );
  });

  it("uses Sui explorer links for Sui chain transaction URLs", () => {
    const config = getNetworkConfig("sui-regtest", { applyEnvOverrides: false });

    expect(getChainTransactionUrl(config, "digest", "sui-regtest")).toBe(
      "https://suiexplorer.com/txblock/digest?network=testnet",
    );
  });
});
