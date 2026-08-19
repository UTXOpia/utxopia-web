"use client";

/**
 * Which login this browser is on, and how to leave it.
 *
 * There was no way out before: a member who signed in with the wrong Google
 * account had no control anywhere that would put them on the right one.
 *
 * Signing out is not the same as forgetting the vault, and the copy has to say
 * so, because the two look identical from here — one drops a session, the other
 * drops the only wrapping this device holds. It is also not reversible by any
 * other account: this browser's wrapping is bound to the login that armed it,
 * so coming back as somebody else fails with that, not with a wrong PIN.
 */

import { useState } from "react";
import { LogOut, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePrivySolanaAuthority } from "@/lib/privy-solana-context";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

export function LoginSection() {
  const privy = usePrivySolanaAuthority();
  const clearKeys = useUTXOpiaStore((s) => s.clearKeys);
  const [busy, setBusy] = useState(false);

  if (!privy.enabled || !privy.authenticated) return null;

  const signOut = async () => {
    setBusy(true);
    try {
      // Keys first. Leaving an unlocked vault on screen behind a login that is
      // no longer signed in reads as still being signed in.
      clearKeys();
      await privy.logout();
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[11px] font-medium uppercase tracking-wider text-gray/50">Login</h2>

      <div className="flex flex-col gap-3 rounded-[12px] border border-gray/15 bg-muted/25 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className="text-caption text-gray">Signed in as</p>
            <p className="truncate font-mono text-body2 text-foreground">
              {privy.accountLabel ?? "your account"}
            </p>
          </div>
          <button
            type="button"
            onClick={() => void signOut()}
            disabled={busy}
            className={cn(
              "flex shrink-0 items-center gap-1.5 rounded-[10px] border border-gray/20 px-3 py-2",
              "text-caption font-semibold text-foreground transition-colors",
              "hover:border-gray/40 disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {busy ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
            ) : (
              <LogOut className="h-3.5 w-3.5" aria-hidden />
            )}
            Sign out
          </button>
        </div>

        <p className="text-caption leading-relaxed text-gray">
          This does not forget your vault — the wrapping stays on this device, and this same
          account plus your PIN reopens it. A different account will not: the wrapping is bound to
          the login that made it. To remove the vault from this browser, use{" "}
          <span className="text-gray-light">Forget this vault</span> under Recovery.
        </p>
      </div>
    </section>
  );
}
