/**
 * Central Solana network configuration utility.
 * Maps SDK config to all network-dependent values.
 * This is the ONLY file that should contain Solana explorer URL logic.
 */
import { getConfig } from "@utxopia/sdk";
import type { NetworkId } from "@/lib/network-config";

/** Solana explorer cluster query parameter */
export function getSolanaCluster(networkId?: NetworkId): string {
  const net = networkId ?? getConfig().network;
  switch (net) {
    case "mainnet":
      return ""; // mainnet-beta is the default, no cluster param needed
    case "devnet":
    case "devnet-regtest":
      return "devnet";
    case "testnet":
      return "testnet";
    case "localnet":
      return "custom&customUrl=http%3A%2F%2Flocalhost%3A8899";
    default:
      return "devnet";
  }
}

/** Solana explorer transaction URL */
export function getSolanaExplorerTxUrl(signature: string, networkId?: NetworkId): string {
  const cluster = getSolanaCluster(networkId);
  const base = `https://explorer.solana.com/tx/${signature}`;
  return cluster ? `${base}?cluster=${cluster}` : base;
}

/** Solana explorer address URL */
export function getSolanaExplorerAddressUrl(address: string, networkId?: NetworkId): string {
  const cluster = getSolanaCluster(networkId);
  const base = `https://explorer.solana.com/address/${address}`;
  return cluster ? `${base}?cluster=${cluster}` : base;
}
