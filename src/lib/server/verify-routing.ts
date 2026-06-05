import type { NextRequest } from "next/server";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  networkChain,
  type NetworkConfig,
} from "@/lib/network-config";

export type SupportedVerifyBitcoinNetwork = "mainnet" | "testnet" | "testnet4" | "signet" | "regtest";

export function resolveVerifyConfig(request: NextRequest): {
  config: NetworkConfig;
  esploraApiUrl: string;
  bitcoinNetwork: SupportedVerifyBitcoinNetwork;
} | { error: string; status: number } {
  const network = detectNetworkFromRequest(request);
  if (networkChain(network) !== "sol") {
    return {
      error: "/api/verify is a Solana SPV verifier. Use /api/sui/relay for Sui BTC deposit completion.",
      status: 400,
    };
  }

  const config = getNetworkConfig(network, { applyEnvOverrides: false });
  return {
    config,
    esploraApiUrl: getConfiguredEsploraApiUrl(config),
    bitcoinNetwork: normalizeBitcoinNetwork(config.bitcoin.network),
  };
}

export function normalizeBitcoinNetwork(value: string | undefined): SupportedVerifyBitcoinNetwork {
  switch (value) {
    case "mainnet":
    case "testnet":
    case "testnet4":
    case "signet":
    case "regtest":
      return value;
    default:
      return "testnet4";
  }
}

export function getConfiguredEsploraApiUrl(config: NetworkConfig): string {
  const explorerUrl = config.bitcoin.explorerUrl?.trim();
  if (explorerUrl) {
    const trimmed = explorerUrl.replace(/\/$/, "");
    return trimmed.endsWith("/api") ? trimmed : `${trimmed}/api`;
  }
  switch (normalizeBitcoinNetwork(config.bitcoin.network)) {
    case "mainnet":
      return "https://mempool.space/api";
    case "testnet":
      return "https://mempool.space/testnet/api";
    case "testnet4":
      return "https://mempool.space/testnet4/api";
    case "signet":
      return "https://mempool.space/signet/api";
    case "regtest":
      return "http://localhost:2140";
  }
}
