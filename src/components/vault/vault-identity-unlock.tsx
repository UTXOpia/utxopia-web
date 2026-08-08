"use client";

import { useState } from "react";
import { AlertCircle, KeyRound, Loader2 } from "lucide-react";
import { useUTXOpia } from "@/hooks/use-utxopia";
import { useChainEnvironment } from "@/lib/chain-environment";
import { cn } from "@/lib/utils";

/**
 * Unlock this pool's private identity, in place.
 *
 * A private identity is per-pool and is *derived at first unlock* — the seed
 * comes from a wallet signature (`deriveKeys`, utxopia-store), so hydration can
 * only restore one that already exists, never create the first one. That is
 * deliberate and cannot be done silently: Verified costs two signatures.
 *
 * What was not deliberate is where a member met it. Anyone who redeemed an
 * invite and went straight to Add funds saw an empty "Private destination", a
 * greyed-out submit button, and — on the SOL path — no explanation whatsoever.
 * The way out was to visit /vault first, which nothing on the page said.
 *
 * So the prompt goes where the wall is. Nothing here moves funds; a signature
 * is not a transaction, and the copy says so, because being asked to sign twice
 * with no reason given is exactly the moment a careful person walks away.
 */
export function VaultIdentityUnlock({ className }: { className?: string }) {
  const { keys, deriveKeys, isLoading } = useUTXOpia();
  const { vaultId } = useChainEnvironment();
  const [error, setError] = useState<string | null>(null);

  // The wallet gate is the caller's business — this renders only when there is
  // a wallet but no identity for the pool in front of us.
  if (keys) return null;

  const label = vaultId === "verified" ? "Verified" : "Open";

  const unlock = async () => {
    setError(null);
    try {
      await deriveKeys();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Could not unlock this vault — try again.",
      );
    }
  };

  return (
    <div className={cn("rounded-[12px] border border-privacy/25 bg-privacy/5 p-4", className)}>
      <p className="text-caption font-semibold text-foreground">
        Unlock your {label} vault to deposit
      </p>
      <p className="mt-1 text-caption leading-relaxed text-gray">
        Each pool has its own private identity, so nothing links what you do here to the other
        one. Creating it asks your wallet to sign
        {vaultId === "verified" ? " twice" : ""} — signatures are not transactions and move
        nothing.
      </p>

      {error && (
        <div className="mt-3 flex items-start gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <span className="text-caption text-red-400">{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={unlock}
        disabled={isLoading}
        data-testid="vault-identity-unlock"
        className={cn(
          "mt-3 flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px]",
          "bg-foreground px-3 text-caption font-semibold text-background transition-colors",
          "hover:bg-white disabled:cursor-not-allowed disabled:bg-gray/30 disabled:text-gray",
        )}
      >
        {isLoading ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <KeyRound className="h-4 w-4" aria-hidden />}
        {isLoading ? "Waiting for your signature…" : `Unlock ${label} vault`}
      </button>
    </div>
  );
}
