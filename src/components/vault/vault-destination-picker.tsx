"use client";

// Vault-scope controls for value flows. Vaults are separate on-chain pools;
// both pickers rewrite ?vault= so the whole flow re-scopes.
// - Destination (deposit): Verified is offered to entitled users — members of
//   the vault, or anyone already holding funds in it; everyone else gets a quiet
//   invite row. Membership is the load-bearing half: funds alone cannot be the
//   test, because a member's *first* deposit necessarily happens before they
//   have any, which left the invited unable to reach the vault they joined.
// - Source (send/cash out): balance-driven — segmented when both vaults hold
//   funds, a static chip when one does, silent auto-switch when the current
//   vault is empty but the other is funded.

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { ShieldCheck, Unlock } from "lucide-react";
import { cn } from "@/lib/utils";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithVault, vaultsSupported, type VaultId } from "@/lib/vault-config";
import { useSiblingVaultBalances } from "@/hooks/use-sibling-vault-balances";
import { RedeemInvite } from "@/components/redeem-invite";
import { useVerifiedMembership } from "@/hooks/use-verified-membership";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

const hasFunds = (balances: Record<string, bigint>): boolean =>
  Object.values(balances).some((amount) => amount > 0n);

// Read the live URL at call time (handlers/effects only) so the picker never
// touches useSearchParams, which would force a Suspense boundary at prerender.
const currentHrefWithVault = (target: VaultId): string =>
  hrefWithVault(`${window.location.pathname}${window.location.search}`, target);

/** "From" control for send/cash-out. Rendered above the form. */
export function VaultSourcePicker({ className }: { className?: string }) {
  const { networkId, vaultId } = useChainEnvironment();
  const sibling = useSiblingVaultBalances();
  const activeBalances = useUTXOpiaStore((s) => s.inboxBalancesByToken);
  const inboxLoading = useUTXOpiaStore((s) => s.inboxLoading);
  const router = useRouter();
  const autoSwitched = useRef(false);

  const activeFunded = hasFunds(activeBalances ?? {});
  const siblingFunded = sibling.status === "ready" && hasFunds(sibling.balancesByToken);

  const select = (target: VaultId) => {
    if (target === vaultId) return;
    router.replace(currentHrefWithVault(target));
  };

  // Current vault is empty but the other one holds funds: move there silently
  // so the user is never staring at an unusable form. Once per mount.
  useEffect(() => {
    if (autoSwitched.current || inboxLoading) return;
    if (!activeFunded && siblingFunded) {
      autoSwitched.current = true;
      select(sibling.vaultId);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeFunded, siblingFunded, inboxLoading]);

  if (!vaultsSupported(networkId)) return null;
  // Nothing to choose: only the current vault is funded (or nothing is known yet).
  if (!(activeFunded && siblingFunded)) {
    if (!activeFunded) return null;
    const Icon = vaultId === "verified" ? ShieldCheck : Unlock;
    return (
      <div className={cn("mb-4 flex items-center gap-1.5 px-1 text-[11px] text-gray/50", className)}>
        From
        <span className="inline-flex items-center gap-1 rounded-full border border-gray/15 bg-muted/40 px-2 py-0.5 text-foreground/80">
          <Icon className={cn("h-3 w-3", vaultId === "verified" && "text-privacy")} />
          {vaultId === "verified" ? "Verified" : "Open"}
        </span>
      </div>
    );
  }

  return (
    <div className={cn("mb-4", className)}>
      <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-gray/50">
        From
      </p>
      <div className="grid grid-cols-2 gap-1 rounded-[12px] border border-gray/15 bg-muted/30 p-1">
        {(
          [
            { id: "open" as const, label: "Open", icon: Unlock },
            { id: "verified" as const, label: "Verified", icon: ShieldCheck },
          ]
        ).map(({ id, label, icon: Icon }) => {
          const active = vaultId === id;
          return (
            <button
              key={id}
              type="button"
              onClick={() => select(id)}
              aria-pressed={active}
              className={cn(
                "flex min-h-9 items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-medium transition-colors cursor-pointer",
                active
                  ? "bg-card text-foreground border border-gray/20"
                  : "text-gray/60 hover:text-foreground",
              )}
            >
              <Icon className={cn("h-3.5 w-3.5", id === "verified" && active && "text-privacy")} />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export function VaultDestinationPicker({ className }: { className?: string }) {
  const { networkId, vaultId } = useChainEnvironment();
  const sibling = useSiblingVaultBalances();
  const { publicKey } = useWallet();
  const stealthAddressEncoded = useUTXOpiaStore((s) => s.stealthAddressEncoded);
  const router = useRouter();
  const [showApply, setShowApply] = useState(false);
  const membership = useVerifiedMembership();

  if (!vaultsSupported(networkId)) return null;

  const verifiedBalances =
    vaultId === "verified" ? null : sibling.status === "ready" ? sibling.balancesByToken : null;
  const entitled =
    vaultId === "verified" ||
    membership === "member" ||
    (verifiedBalances !== null &&
      Object.values(verifiedBalances).some((amount) => amount > 0n));

  const select = (target: VaultId) => {
    if (target === vaultId) return;
    router.replace(currentHrefWithVault(target));
  };

  const actor = publicKey?.toBase58() ?? stealthAddressEncoded ?? "";

  return (
    <div className={cn("mb-4", className)}>
      <p className="mb-1.5 px-1 text-[11px] font-medium uppercase tracking-wider text-gray/50">
        Destination
      </p>
      {entitled ? (
        <div className="grid grid-cols-2 gap-1 rounded-[12px] border border-gray/15 bg-muted/30 p-1">
          {(
            [
              { id: "open" as const, label: "Open", icon: Unlock },
              { id: "verified" as const, label: "Verified", icon: ShieldCheck },
            ]
          ).map(({ id, label, icon: Icon }) => {
            const active = vaultId === id;
            return (
              <button
                key={id}
                type="button"
                onClick={() => select(id)}
                aria-pressed={active}
                className={cn(
                  "flex min-h-9 items-center justify-center gap-1.5 rounded-[9px] text-[13px] font-medium transition-colors cursor-pointer",
                  active
                    ? "bg-card text-foreground border border-gray/20"
                    : "text-gray/60 hover:text-foreground",
                )}
              >
                <Icon className={cn("h-3.5 w-3.5", id === "verified" && active && "text-privacy")} />
                {label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="rounded-[12px] border border-gray/15 bg-muted/30 p-1">
          <div className="flex min-h-9 items-center justify-center gap-1.5 rounded-[9px] bg-card border border-gray/20 text-[13px] font-medium text-foreground">
            <Unlock className="h-3.5 w-3.5" />
            Open
          </div>
          {actor && (
            <div className="px-2 pb-1.5 pt-2">
              {showApply ? (
                <RedeemInvite networkId={networkId} />
              ) : (
                <button
                  type="button"
                  onClick={() => setShowApply(true)}
                  className="flex w-full items-center gap-1.5 text-[11px] text-gray/45 hover:text-privacy transition-colors cursor-pointer"
                >
                  <ShieldCheck className="h-3 w-3" />
                  Verified Privacy · Have an invite code?
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
