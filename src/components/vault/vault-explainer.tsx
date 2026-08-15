"use client";

// "Open" and "Verified" are pool names, not adjectives a first-time user can
// decode. Before this, the only place the difference surfaced was a policy
// rejection — education by error message. Copy comes from vault-config so the
// pool descriptions have exactly one home.

import { ShieldCheck, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import Link from "next/link";
import { hrefWithChain, type NetworkId } from "@/lib/network-config";
import { getVaultRuntimeConfig, vaultsSupported, type VaultId } from "@/lib/vault-config";

const ICONS: Record<VaultId, typeof Unlock> = { open: Unlock, verified: ShieldCheck };

export function VaultExplainer({
  networkId,
  className,
}: {
  networkId: NetworkId;
  className?: string;
}) {
  if (!vaultsSupported(networkId)) return null;

  return (
    <details className={cn("group mt-1.5 px-1", className)}>
      <summary className="list-none inline-flex cursor-pointer items-center gap-1 text-[11px] text-gray/45 transition-colors hover:text-privacy [&::-webkit-details-marker]:hidden">
        What&apos;s the difference?
      </summary>
      <div className="mt-2 space-y-2 rounded-[10px] border border-gray/10 bg-muted/20 px-3 py-2.5">
        {(["open", "verified"] as const).map((id) => {
          const vault = getVaultRuntimeConfig(networkId, id);
          const Icon = ICONS[id];
          return (
            <div key={id} className="flex gap-2">
              <Icon
                className={cn(
                  "mt-0.5 h-3 w-3 shrink-0",
                  id === "verified" ? "text-privacy" : "text-gray/50",
                )}
              />
              <p className="text-[11px] leading-relaxed text-gray">
                <span className="font-medium text-foreground/90">{vault.name}</span>
                {" — "}
                {vault.description}
              </p>
            </div>
          );
        })}
        <p className="border-t border-gray/10 pt-2 text-[11px] leading-relaxed text-gray/60">
          The two pools are separate. Funds do not move between them, and each has its own
          anonymity set.{" "}
          <Link
            href={hrefWithChain("/docs#pools", networkId)}
            className="text-privacy/70 transition-colors hover:text-privacy"
          >
            Learn more
          </Link>
        </p>
      </div>
    </details>
  );
}
