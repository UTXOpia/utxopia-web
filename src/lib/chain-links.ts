import { getChainAdapter, networkForChain } from "@/lib/chain-registry";
import type { NetworkConfig, NetworkId } from "@/lib/network-config";
import { getSolanaExplorerTxUrl } from "@/lib/solana-network";

export type SuiExplorerNetwork = "mainnet" | "testnet" | "devnet";

export function getSuiExplorerNetwork(networkId?: NetworkId): SuiExplorerNetwork {
  if (!networkId) return "testnet";
  const suiNetwork = networkForChain(networkId, "sui");
  switch (suiNetwork) {
    case "sui-testnet":
    case "sui-regtest":
      return "testnet";
    default:
      return "testnet";
  }
}

export function getSuiObjectUrl(baseUrl: string, objectId: string, networkId?: NetworkId): string {
  return `${cleanExplorerBaseUrl(baseUrl)}/object/${objectId}?network=${getSuiExplorerNetwork(networkId)}`;
}

export function getSuiTransactionUrl(baseUrl: string, txId: string, networkId?: NetworkId): string {
  return `${cleanExplorerBaseUrl(baseUrl)}/txblock/${txId}?network=${getSuiExplorerNetwork(networkId)}`;
}

export function makeSuiExplorerLinks(baseUrl: string, networkId?: NetworkId) {
  return {
    object: (objectId: string) => getSuiObjectUrl(baseUrl, objectId, networkId),
    tx: (txId: string) => getSuiTransactionUrl(baseUrl, txId, networkId),
  };
}

export function getChainTransactionUrl(config: NetworkConfig, txId: string, networkId?: NetworkId): string {
  const chain = getChainAdapter(config);
  if (chain.id === "sui" && config.sui) {
    return getSuiTransactionUrl(config.sui.explorerUrl, txId, networkId);
  }
  return getSolanaExplorerTxUrl(txId, networkId);
}

export function getChainIcon(config: NetworkConfig): string {
  const chain = getChainAdapter(config);
  return `/tokens/${chain.query}.png`;
}

export function getChainLinkClass(config: NetworkConfig): string {
  const chain = getChainAdapter(config);
  return chain.id === "sui"
    ? "text-sui/70 hover:text-sui"
    : "text-gray hover:text-gray-light";
}

export function getChainMutedLinkClass(config: NetworkConfig): string {
  const chain = getChainAdapter(config);
  return chain.id === "sui"
    ? "text-sui/40 hover:text-sui"
    : "text-purple-400/40 hover:text-purple-400";
}

function cleanExplorerBaseUrl(baseUrl: string): string {
  return baseUrl.replace(/\/$/, "");
}
