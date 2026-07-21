import type { NetworkConfig, NetworkId } from "@/lib/network-config";

export type ChainId = NonNullable<NetworkConfig["chain"]>;

export interface ChainAdapter {
  id: ChainId;
  query: "sol";
  displayName: string;
  nativeToken: string;
  defaultNetwork: NetworkId;
  hybridNetwork?: NetworkId;
  networkIds: readonly NetworkId[];
}

export const CHAIN_ADAPTERS: Record<ChainId, ChainAdapter> = {
  solana: {
    id: "solana",
    query: "sol",
    displayName: "Solana",
    nativeToken: "SOL",
    defaultNetwork: "devnet-regtest",
    hybridNetwork: "devnet-regtest",
    networkIds: ["devnet", "devnet-regtest", "testnet", "mainnet", "localnet"],
  },
};

export function chainIdFromConfig(config: NetworkConfig): ChainId {
  return config.chain ?? "solana";
}

export function getChainAdapter(configOrChain: NetworkConfig | ChainId | undefined): ChainAdapter {
  const chain = typeof configOrChain === "string"
    ? configOrChain
    : configOrChain
      ? chainIdFromConfig(configOrChain)
      : "solana";
  return CHAIN_ADAPTERS[chain];
}

export function isNetworkForChain(networkId: NetworkId, chain: ChainId): boolean {
  return CHAIN_ADAPTERS[chain].networkIds.includes(networkId);
}

export function networkForChain(networkId: NetworkId, chain: ChainId): NetworkId {
  return isNetworkForChain(networkId, chain) ? networkId : CHAIN_ADAPTERS[chain].defaultNetwork;
}

export function isHybridNetwork(networkId: NetworkId): boolean {
  return Object.values(CHAIN_ADAPTERS).some((adapter) => adapter.hybridNetwork === networkId);
}

export function isChainHybridNetwork(networkId: NetworkId, chain: ChainId): boolean {
  return CHAIN_ADAPTERS[chain].hybridNetwork === networkId;
}

export function getNetworkConfigReadoutRows(config: NetworkConfig): Array<[string, string, string?]> {
  return [
    ["Solana RPC", config.solana.rpcUrl, config.solana.rpcUrl],
    ["Program", config.solana.utxopiaProgramId],
    ["zkBTC mint", config.tokens.zkbtcMint],
    ["BTC pool", config.bitcoin.poolAddress],
    ["BTC network", config.bitcoin.network],
    ["Backend", config.backend.url, config.backend.url],
    ["BTC explorer", config.bitcoin.explorerUrl, config.bitcoin.explorerUrl],
  ];
}
