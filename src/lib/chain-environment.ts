"use client";

import { useSyncExternalStore } from "react";
import { initConfig, UTXOpiaClient, type NetworkConfig as SdkNetworkConfig } from "@utxopia/sdk";
import { getChainAdapter, type ChainId } from "@/lib/chain-registry";
import { getSolanaRpcUrl } from "@/lib/api/constants";
import {
  detectNetwork,
  getNetworkConfig,
  NETWORK_CHANGE_EVENT,
  type NetworkConfig,
  type NetworkId,
} from "@/lib/network-config";
import {
  getVaultNetworkConfig,
  parseVaultId,
  type VaultId,
} from "@/lib/vault-config";

export interface ChainEnvironment {
  networkId: NetworkId;
  vaultId: VaultId;
  config: NetworkConfig;
}

let configuredIdentity: string | null = null;
let configurePromise: Promise<SdkNetworkConfig> | null = null;

const SDK_INITIALIZERS: Record<ChainId, (env: ChainEnvironment) => Promise<void>> = {
  solana: async (env) => {
    const identity = `${env.networkId}:${env.vaultId}`;
    if (configuredIdentity !== identity || !configurePromise) {
      configurePromise = initConfig({
        utxopiaProgramId: env.config.solana.utxopiaProgramId,
        zkbtcMint: env.config.tokens.zkbtcMint,
        // Browser-side, this resolves to the same-origin /api/rpc proxy: the
        // configured RPC URL is either keyed (and must not reach the client) or
        // tokenless (and answers 403).
        solanaRpcUrl: getSolanaRpcUrl(),
        ikaDwalletXOnlyPubkey: env.config.ika?.dwalletXOnlyPubkey,
        depositMode: env.config.bitcoin.depositMode,
      });
      configuredIdentity = identity;
    }

    await configurePromise;

    if (!UTXOpiaClient.isInitialized) {
      await UTXOpiaClient.init({ backendUrl: "" });
    }
  },
};

const ROUTE_CHANGE_EVENT = "utxopia:route-change";
const HISTORY_PATCH_KEY = "__utxopiaHistoryEventsInstalled";

function installHistoryEvents(): void {
  if (typeof window === "undefined") return;
  const markedWindow = window as typeof window & {
    [HISTORY_PATCH_KEY]?: boolean;
  };
  if (markedWindow[HISTORY_PATCH_KEY]) return;
  markedWindow[HISTORY_PATCH_KEY] = true;
  const originalPushState = window.history.pushState.bind(window.history);
  const originalReplaceState = window.history.replaceState.bind(window.history);
  window.history.pushState = (data, unused, url) => {
    originalPushState(data, unused, url);
    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
  };
  window.history.replaceState = (data, unused, url) => {
    originalReplaceState(data, unused, url);
    window.dispatchEvent(new Event(ROUTE_CHANGE_EVENT));
  };
}

function subscribeToNetwork(onChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};
  installHistoryEvents();
  window.addEventListener("storage", onChange);
  window.addEventListener(NETWORK_CHANGE_EVENT, onChange);
  window.addEventListener("popstate", onChange);
  window.addEventListener(ROUTE_CHANGE_EVENT, onChange);
  // Hydration starts from the stable server snapshot. Re-check the real URL
  // once subscribed so a direct ?vault=verified load cannot stay on Open.
  queueMicrotask(onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(NETWORK_CHANGE_EVENT, onChange);
    window.removeEventListener("popstate", onChange);
    window.removeEventListener(ROUTE_CHANGE_EVENT, onChange);
  };
}

export function detectVault(): VaultId {
  if (typeof window === "undefined") return "open";
  return parseVaultId(new URLSearchParams(window.location.search).get("vault"));
}

export function getChainEnvironment(
  networkId: NetworkId = detectNetwork(),
  vaultId: VaultId = detectVault(),
): ChainEnvironment {
  const base = getNetworkConfig(networkId, { applyEnvOverrides: false });
  return {
    networkId,
    vaultId,
    config: getVaultNetworkConfig(networkId, base, vaultId),
  };
}

export function useChainEnvironment(): ChainEnvironment {
  const selection = useSyncExternalStore<string>(
    subscribeToNetwork,
    () => `${detectNetwork()}:${detectVault()}`,
    // Server snapshot: follow the env-resolved default (NEXT_PUBLIC_NETWORK) so
    // SSR matches the build's network instead of hardcoding devnet. detectNetwork()
    // is SSR-safe (guards `window`) and, for a fresh visitor, matches the client
    // snapshot — avoiding a hydration mismatch.
    () => `${detectNetwork()}:open`,
  );
  const [networkId, vaultId] = selection.split(":") as [NetworkId, VaultId];
  return getChainEnvironment(networkId, vaultId);
}

export async function ensureChainEnvironment(
  networkId: NetworkId = detectNetwork(),
  vaultId: VaultId = detectVault(),
): Promise<ChainEnvironment> {
  const env = getChainEnvironment(networkId, vaultId);
  await SDK_INITIALIZERS[getChainAdapter(env.config).id](env);
  return env;
}
