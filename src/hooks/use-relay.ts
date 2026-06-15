"use client";

import { useMemo } from "react";
import { getBuiltinRelays, serializableToConfig, type RelayConfig } from "@/lib/relays";
import { resolveAutoRelay } from "@/lib/relay-health";
import { useRelayStore } from "@/stores/relay-store";

/** All relays for a chain: built-ins + user-added custom relays. */
export function useRelays(chainId: string): RelayConfig[] {
  const customRelays = useRelayStore((s) => s.customRelays);
  return useMemo(() => {
    const builtins = getBuiltinRelays(chainId);
    const customs = customRelays.map(serializableToConfig);
    return [...builtins, ...customs];
  }, [chainId, customRelays]);
}

/**
 * Resolves the current `mode` to a concrete RelayConfig.
 * - "auto" → resolveAutoRelay over all relays for the chain using last-known health.
 * - pinned id → find that relay in builtins + customs, fall back to auto if missing.
 */
export function useEffectiveRelay(chainId: string): RelayConfig | null {
  const relays = useRelays(chainId);
  const mode = useRelayStore((s) => s.mode);
  const health = useRelayStore((s) => s.health);

  return useMemo(() => {
    if (mode === "auto") {
      return resolveAutoRelay(relays, health);
    }
    const pinned = relays.find((r) => r.id === mode);
    if (pinned) return pinned;
    // Pinned relay no longer exists — fall back to auto.
    return resolveAutoRelay(relays, health);
  }, [relays, mode, health]);
}

/**
 * Returns the URL string to use for relay submission.
 * Falls back to the first builtin's URL when nothing can be resolved
 * (no health data yet), so the submit path always has a value.
 */
export function useEffectiveRelayUrl(chainId: string, networkId: string): string {
  const effective = useEffectiveRelay(chainId);
  const relays = useRelays(chainId);

  return useMemo(() => {
    if (effective) return effective.url(networkId);
    // No health data yet — use first builtin as cold-start default.
    const fallback = relays[0];
    return fallback ? fallback.url(networkId) : `/api/${chainId}/relay?network=${encodeURIComponent(networkId)}`;
  }, [effective, relays, chainId, networkId]);
}
