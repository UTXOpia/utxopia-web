import { describe, expect, it } from "bun:test";
import {
  getChainTransactionUrl,
  getSuiExplorerNetwork,
  getSuiObjectUrl,
  getSuiTransactionUrl,
} from "./chain-links";
import { getNetworkConfigReadoutRows } from "./chain-registry";
import { getNetworkConfig } from "./network-config";
import {
  getSolanaCluster,
  getSolanaExplorerAddressUrl,
  getSolanaExplorerTxUrl,
} from "./solana-network";

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

  it("includes backend and Bitcoin context in Sui network readout rows", () => {
    const config = getNetworkConfig("sui-regtest", { applyEnvOverrides: false });
    const labels = getNetworkConfigReadoutRows(config).map(([label]) => label);

    expect(labels).toContain("Sui RPC");
    expect(labels).toContain("Backend");
    expect(labels).toContain("BTC network");
    expect(labels).toContain("BTC explorer");
  });

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
  });
});
