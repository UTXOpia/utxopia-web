"use client";

import Link from "next/link";
import { ShieldCheck, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { hrefWithChain, type NetworkId } from "@/lib/network-config";
import {
  hrefWithVault,
  type VaultId,
} from "@/lib/vault-config";

export function VaultSwitcher({
  networkId,
  vaultId,
}: {
  networkId: NetworkId;
  vaultId: VaultId;
}) {
  const vaults = [
    { id: "open" as const, label: "Open Privacy", icon: Unlock },
    { id: "verified" as const, label: "Verified Privacy", icon: ShieldCheck },
  ];

  return (
    <div
      className="mb-5 grid grid-cols-2 gap-1 rounded-xl border border-gray/20 bg-muted/50 p-1"
      aria-label="Privacy vault"
    >
      {vaults.map((vault) => {
        const Icon = vault.icon;
        const active = vault.id === vaultId;
        return (
          <Link
            key={vault.id}
            href={hrefWithVault(hrefWithChain("/vault", networkId), vault.id)}
            className={cn(
              "flex min-h-10 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors",
              active
                ? "bg-card text-foreground shadow-sm"
                : "text-gray hover:text-foreground",
            )}
            aria-current={active ? "page" : undefined}
          >
            <Icon className={cn("h-3.5 w-3.5", active && "text-privacy")} />
            {vault.label}
          </Link>
        );
      })}
    </div>
  );
}
