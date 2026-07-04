import { describe, expect, it } from "bun:test";
import {
  getConfiguredEsploraApiUrl,
  normalizeBitcoinNetwork,
  resolveVerifyConfig,
} from "@/lib/server/verify-routing";
import { getNetworkConfig } from "@/lib/network-config";

describe("/api/verify network routing", () => {
  it("rejects Sui requests because deposit verification is chain-specific", () => {
    const result = resolveVerifyConfig(
      new Request("https://app.utxopia.test/api/verify?network=sui-regtest") as any,
    );

    expect(result).toEqual({
      error: "/api/verify is a Solana SPV verifier. Use /api/sui/relay for Sui BTC deposit completion.",
      status: 400,
    });
  });

  it("resolves Solana hybrid verification from the selected network config", () => {
    const result = resolveVerifyConfig(
      new Request("https://app.utxopia.test/api/verify?network=devnet-regtest") as any,
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.config.bitcoin.network).toBe("regtest");
    expect(result.bitcoinNetwork).toBe("regtest");
    expect(result.esploraApiUrl).toBe("https://btc.utxopia.com/regtest/api");
    expect(result.config.solana.rpcUrl).toBe(getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }).solana.rpcUrl);
  });

  it("falls back from unsupported Solana testnet to hybrid verification", () => {
    const result = resolveVerifyConfig(
      new Request("https://app.utxopia.test/api/verify?network=testnet") as any,
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.config.bitcoin.network).toBe("regtest");
    expect(result.bitcoinNetwork).toBe("regtest");
  });

  it("keeps testnet4 and mainnet Esplora URLs config-driven", () => {
    expect(getConfiguredEsploraApiUrl(getNetworkConfig("devnet", { applyEnvOverrides: false }))).toBe(
      "https://mempool.space/testnet4/api",
    );
    expect(getConfiguredEsploraApiUrl(getNetworkConfig("mainnet", { applyEnvOverrides: false }))).toBe(
      "https://mempool.space/api",
    );
  });

  it("defaults unknown Bitcoin network strings to testnet4", () => {
    expect(normalizeBitcoinNetwork("unknown")).toBe("testnet4");
    expect(normalizeBitcoinNetwork(undefined)).toBe("testnet4");
  });
});
