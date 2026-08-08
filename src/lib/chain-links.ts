import { getChainAdapter } from "@/lib/chain-registry";
import type { NetworkConfig, NetworkId } from "@/lib/network-config";
import { getSolanaExplorerAddressUrl, getSolanaExplorerTxUrl } from "@/lib/solana-network";

export function getChainTransactionUrl(config: NetworkConfig, txId: string, networkId?: NetworkId): string {
  return getSolanaExplorerTxUrl(txId, networkId);
}

export function getChainAddressUrl(config: NetworkConfig, addressOrObjectId: string, networkId?: NetworkId): string {
  return getSolanaExplorerAddressUrl(addressOrObjectId, networkId);
}

export function getChainIcon(config: NetworkConfig): string {
  const chain = getChainAdapter(config);
  return `/tokens/${chain.query}.png`;
}

export function getChainLinkClass(_config: NetworkConfig): string {
  return "text-gray hover:text-gray-light";
}

export function getChainMutedLinkClass(_config: NetworkConfig): string {
  return "text-purple-400/40 hover:text-purple-400";
}
