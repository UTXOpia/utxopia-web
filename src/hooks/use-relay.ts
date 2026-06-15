"use client";

import { useMemo } from "react";
import { getBuiltinRelays, serializableToConfig, type RelayConfig } from "@/lib/relays";
import { resolveAutoRelay } from "@/lib/relay-health";
import { useRelayStore } from "@/stores/relay-store";
import type { RelayHealth } from "@/lib/relay-health";

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

/**
 * Returns an ordered list of relay URLs to try for submission:
 * 1. The effective relay (auto-resolved or pinned) first.
 * 2. All other currently-online relays sorted by ascending latency.
 *
 * Today the registry has one relay per chain, so this yields a 1-element array.
 * The loop in submitWithFailover handles any length correctly.
 */
export function useRelayCandidates(chainId: string, networkId: string): string[] {
  const primaryUrl = useEffectiveRelayUrl(chainId, networkId);
  const relays = useRelays(chainId);
  const health = useRelayStore((s) => s.health);

  return useMemo(() => {
    // Collect fallback candidates: relays whose URL differs from primary,
    // that are currently online or slow, sorted by ascending latency.
    const fallbacks = relays
      .map((r) => ({ relay: r, h: health[r.id] as RelayHealth | undefined }))
      .filter(({ relay, h }) => {
        const url = relay.url(networkId);
        if (url === primaryUrl) return false;
        return h?.status === "online" || h?.status === "slow";
      })
      .sort((a, b) => {
        const la = a.h?.latencyMs ?? Infinity;
        const lb = b.h?.latencyMs ?? Infinity;
        return la - lb;
      })
      .map(({ relay }) => relay.url(networkId));

    return [primaryUrl, ...fallbacks];
  }, [primaryUrl, relays, health, networkId]);
}
