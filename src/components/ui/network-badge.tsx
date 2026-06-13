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
 * no hidden-production default yet; devnet/testnet4 and regtest users need the
 * same visible context as Sui users before signing financial actions.
 */
export function NetworkBadge() {
  const active = useSyncExternalStore(
    subscribe,
    () => detectNetwork(),
    () => "devnet" as const,
  );

  const badge = getNetworkBadgePresentation(active);
  const isSui = badge.chain === "sui";

  return (
    <Link
      href={hrefWithChain("/settings", active)}
      title={badge.title}
      className={cn(
        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[10px] font-semibold uppercase tracking-[0.12em] transition-colors",
        isSui
          ? "border-sui/20 bg-sui/10 text-sui hover:bg-sui/15 hover:border-sui/30"
          : "border-privacy/20 bg-privacy/10 text-privacy hover:bg-privacy/15 hover:border-privacy/30",
      )}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={`/tokens/${badge.chain}.png`} alt="" className="h-3.5 w-3.5 rounded-full" />
      {badge.label}
    </Link>
  );
}
