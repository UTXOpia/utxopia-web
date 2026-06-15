"use client";

import { useEffectiveRelay } from "@/hooks/use-relay";
import { useRelayStore } from "@/stores/relay-store";
import { RelayRows, useRelayHealthChecks } from "@/components/relay/relay-rows";

/**
 * Relay selector — mirrors NetworkSelector's radio-row list pattern.
 *
 * Row 0: "Automatic (recommended)" — resolves via health, rotates among
 *   healthy relays to limit fingerprinting.
 * Row 1…n: One row per relay (builtins + customs). Custom rows have a
 *   remove (×) button.
 * Footer: inline add-custom-relay form (no modal).
 *
 * Health is probed on mount + via an optional "Recheck" affordance.
 * Results drive the green/amber/gray dot + latency caption.
 *
 * The row markup, health-dot styling, and mount-time health checks live in
 * components/relay/relay-rows.tsx and are shared with the per-transaction
 * RelayControl so both surfaces stay visually identical.
 */

interface RelaySelectorProps {
  /** Chain id — passed to useRelays / url(networkId). */
  chainId: string;
  /** Full network id — passed to relay.url() when pinging. */
  networkId: string;
}

export function RelaySelector({ chainId, networkId }: RelaySelectorProps) {
  const mode = useRelayStore((s) => s.mode);
  const health = useRelayStore((s) => s.health);
  const setMode = useRelayStore((s) => s.setMode);
  const effective = useEffectiveRelay(chainId);
  const checks = useRelayHealthChecks(chainId, networkId);

  return (
    <RelayRows
      mode={mode}
      effective={effective}
      onSelect={setMode}
      health={health}
      checks={checks}
    />
  );
}
