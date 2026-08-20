"use client";

/**
 * Taking back the copy we hold.
 *
 * The only control here, and deliberately so. Everything about the PIN backup
 * asks the member to accept that we keep half of their vault; this is what
 * makes that a trade rather than a claim, and what means we cannot be made to
 * hand over something we no longer have.
 *
 * There is no control for setting one up or changing the PIN. Both happen in
 * the setup flow, where the member is already choosing a PIN and a passphrase
 * in one sitting — see `publishLogin` in `vault-setup`. A settings screen that
 * mints portable spend authority off an already-unlocked tab is a different and
 * worse thing than the same act inside a ceremony that just authenticated
 * somebody, which is why `sealLoginEnvelope` refuses to do it without the
 * passkey answering again.
 *
 * ponytail: deletion is therefore one-way — a member who removes their copy
 * gets it back by restoring from their recovery string, which re-publishes.
 * Give this a "set one up" action if that turns out to be a path people
 * actually walk rather than a thing they do once and never revisit.
 */

import { useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { useChainEnvironment } from "@/lib/chain-environment";
import { usePrivyVaultKey } from "@/hooks/use-privy-vault-key";
import { deleteRemoteEnvelope } from "@/lib/vault-remote";
import { PinField } from "@/components/vault/pin-field";
import { SettingsAction } from "@/components/settings/recovery-section";

export function PinBackupSection() {
  const privy = usePrivyVaultKey();
  const { networkId, vaultId } = useChainEnvironment();
  const hasSeed = useUTXOpiaStore((s) => s.vaultSeed !== null);

  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!privy.available || !privy.authenticated || !hasSeed) return null;

  const remove = async () => {
    setError(null);
    setBusy(true);
    try {
      const { signature } = await privy.keyMaterialFor(pin);
      await deleteRemoteEnvelope({ scope: { networkId, vaultId }, pin, signature });
      setConfirming(false);
      setPin("");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the copy.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[11px] font-medium uppercase tracking-wider text-gray/50">
        PIN backup
      </h2>

      {done ? (
        <div className="flex flex-col gap-3 rounded-[12px] border border-gray/15 bg-muted/25 p-4">
          <p className="text-caption leading-relaxed text-gray">
            Our copy is gone. Your recovery string and this device are the way back in — restoring
            from the string on a new device saves a fresh copy, if you want one again.
          </p>
          <button
            type="button"
            onClick={() => setDone(false)}
            className="self-start text-caption text-gray/50 hover:text-foreground transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      ) : !confirming ? (
        <>
          <p className="px-1 text-caption leading-relaxed text-gray/60">
            A locked copy of your vault, so a new device does not need your recovery string. We
            hold the copy and a check of your PIN; opening it takes a signature from your login
            that never reaches us.
          </p>
          <SettingsAction
            title="Delete the copy we hold"
            detail="A new device will need your recovery string again. Nothing on this device changes."
            onClick={() => setConfirming(true)}
            danger
          />
        </>
      ) : (
        <div className="flex flex-col gap-3 rounded-[12px] border border-gray/15 bg-muted/25 p-4">
          <p className="text-caption leading-relaxed text-gray">
            Your PIN proves the request is yours. After this we hold nothing — and cannot be made
            to hand over what we do not have.
          </p>

          <PinField value={pin} onChange={setPin} label="Your PIN" disabled={busy} autoFocus />

          {error && (
            <div className="flex items-start gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
              <span className="text-caption text-red-400">{error}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy || !pin.trim()}
              className={cn(
                "inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[10px] px-4",
                "bg-red-500/90 text-caption font-semibold text-white transition-colors cursor-pointer",
                "hover:bg-red-500 disabled:cursor-not-allowed disabled:bg-gray/25 disabled:text-gray",
              )}
            >
              {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              {busy ? "Deleting…" : "Delete the copy"}
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirming(false);
                setPin("");
                setError(null);
              }}
              disabled={busy}
              className="px-3 text-caption text-gray/50 hover:text-foreground transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
