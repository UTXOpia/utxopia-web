"use client";

import { useState } from "react";
import { KeyRound, Loader2 } from "lucide-react";
import { AuthModal } from "@/components/auth-modal";
import { useUTXOpia } from "@/hooks/use-utxopia";
import { useChainEnvironment } from "@/lib/chain-environment";
import { cn } from "@/lib/utils";

/**
 * Open a vault, in place, where the deposit flow needs one.
 *
 * The prompt goes where the wall is: anyone who redeemed an invite and went
 * straight to Add funds saw an empty "Private destination", a greyed-out submit
 * button, and — on the SOL path — no explanation whatsoever. The way out was to
 * visit /vault first, which nothing on the page said. That much is unchanged.
 *
 * What changed is what it opens. A wallet signature used to *derive* the pool's
 * identity, which is why this had to be met once per pool: the signature was
 * the account. An envelope vault derives every pool from one root, so there is
 * nothing to unlock per pool — there is only "do you have a vault yet", and the
 * sign-in modal is the one place that knows every way to answer it.
 */
export function VaultIdentityUnlock({ className }: { className?: string }) {
  const { keys, isLoading } = useUTXOpia();
  const { vaultId } = useChainEnvironment();
  const [authOpen, setAuthOpen] = useState(false);

  // The wallet gate is the caller's business — this renders only when there is
  // a wallet but no identity for the pool in front of us.
  if (keys) return null;

  const label = vaultId === "verified" ? "Verified" : "Open";

  return (
    <div className={cn("rounded-[12px] border border-privacy/25 bg-privacy/5 p-4", className)}>
      <p className="text-caption font-semibold text-foreground">
        Open your {label} vault to deposit
      </p>
      <p className="mt-1 text-caption leading-relaxed text-gray">
        Deposits land in a private balance only you can spend, so there has to be a vault to land
        in. Open and Verified hold unlinkable addresses derived from the same vault, so opening it
        once covers both.
      </p>

      <button
        type="button"
        onClick={() => setAuthOpen(true)}
        disabled={isLoading}
        data-testid="vault-identity-unlock"
        className={cn(
          "mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px]",
          "bg-foreground px-3 text-caption font-semibold text-background transition-colors",
          "hover:bg-white disabled:cursor-not-allowed disabled:bg-gray/30 disabled:text-gray",
        )}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
        {isLoading ? "Opening\u2026" : `Open ${label} vault`}
      </button>

      <AuthModal open={authOpen} onOpenChange={setAuthOpen} auth={{ error: null }} />
    </div>
  );
}
