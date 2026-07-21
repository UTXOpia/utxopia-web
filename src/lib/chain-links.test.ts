import { describe, expect, it } from "bun:test";
import {
  getChainAddressUrl,
  getChainTransactionUrl,
} from "./chain-links";
import { getNetworkConfig } from "./network-config";
import {
  getSolanaCluster,
  getSolanaExplorerAddressUrl,
  getSolanaExplorerTxUrl,
} from "./solana-network";

describe("chain explorer links", () => {
  it("maps Solana app networks to the Solana Explorer cluster parameter", () => {
    expect(getSolanaCluster("devnet")).toBe("devnet");
    expect(getSolanaCluster("devnet-regtest")).toBe("devnet");
    expect(getSolanaCluster("testnet")).toBe("testnet");
    expect(getSolanaCluster("localnet")).toBe("custom&customUrl=http%3A%2F%2Flocalhost%3A8899");
    expect(getSolanaCluster("mainnet")).toBe("");
  });

  it("builds Solana explorer URLs from the active app network", () => {
    expect(getSolanaExplorerTxUrl("sig", "devnet-regtest")).toBe(
      "https://explorer.solana.com/tx/sig?cluster=devnet",
    );
    expect(getSolanaExplorerAddressUrl("addr", "testnet")).toBe(
      "https://explorer.solana.com/address/addr?cluster=testnet",
    );
    expect(getSolanaExplorerTxUrl("sig", "mainnet")).toBe(
      "https://explorer.solana.com/tx/sig",
    );
  });

  it("uses active Solana network for chain transaction URLs", () => {
    const config = getNetworkConfig("devnet-regtest", { applyEnvOverrides: false });

    expect(getChainTransactionUrl(config, "sig", "devnet-regtest")).toBe(
      "https://explorer.solana.com/tx/sig?cluster=devnet",
    );
    expect(getChainAddressUrl(config, "addr", "devnet-regtest")).toBe(
      "https://explorer.solana.com/address/addr?cluster=devnet",
    );
  });
});
