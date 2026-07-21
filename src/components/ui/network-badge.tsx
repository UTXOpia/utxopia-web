"use client";

import { useSyncExternalStore } from "react";
import Link from "next/link";
import {
  detectNetwork,
  hrefWithChain,
  NETWORK_CHANGE_EVENT,
  NETWORK_META,
  networkChain,
  type NetworkId,
} from "@/lib/network-config";
import { cn } from "@/lib/utils";

function subscribe(onChange: () => void) {
  if (typeof window === "undefined") return () => {};
  window.addEventListener("storage", onChange);
  window.addEventListener(NETWORK_CHANGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(NETWORK_CHANGE_EVENT, onChange);
  };
}

export function getNetworkBadgePresentation(active: NetworkId) {
  const meta = NETWORK_META.find((m) => m.id === active);
  const chain = networkChain(active);
  const networkLabel = meta?.label ?? active;
  // The chain logo carries the chain context, so the badge text is just the
  // network (e.g. "Hybrid"), not "Solana Hybrid".
  const label = networkLabel.split(" (")[0];

  return {
    chain,
    label,
    title: `Active network: ${label}. ${meta?.tagline ?? active}. Click to change.`,
  };
}

/**
 * Header badge that always surfaces the active chain and network. UTXOpia has
 * no hidden-production default yet; devnet/testnet4 and regtest users need
 * clear visible context before signing financial actions.
 */
export function NetworkBadge() {
  const active = useSyncExternalStore(
    subscribe,
    () => detectNetwork(),
    // Server snapshot follows the env-resolved default (NEXT_PUBLIC_NETWORK)
    // instead of hardcoding devnet — see chain-environment.ts.
    () => detectNetwork(),
  );

  const badge = getNetworkBadgePresentation(active);

  return (
    <Link
      href={hrefWithChain("/settings", active)}
      prefetch={false}
      title={badge.title}
      className={cn(
        "inline-flex min-h-8 items-center rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
        "border-privacy/20 bg-privacy/10 text-privacy hover:bg-privacy/15 hover:border-privacy/30",
      )}
    >
      {/* Solana-only: no chain icon; the pill just shows the network (e.g. "Hybrid"). */}
      {badge.label}
    </Link>
  );
}
