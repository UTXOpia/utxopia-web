"use client";

/**
 * Taking back the copy we hold.
 *
 * The only control here, and deliberately so — there is no way to change a PIN.
 *
 * Not an omission. Releasing the row takes a proof of the PIN it was written
 * under, and the alternative — letting a signature alone replace it — hands
 * anyone holding a stolen session the ability to destroy the backup. For most
 * members that is an inconvenience against a device and a recovery string they
 * still have. For the ones who ticked the acknowledgement without saving the
 * string, this copy is the last key to their funds, and losing it is not
 * recoverable by anyone. A twenty-four hour lockout is; this would not be.
 *
 * So a member who forgets their PIN keeps their vault and loses only this path.
 * A member who wants a different PIN deletes and saves a new copy on their next
 * restore. Both are said on screen, where the choice is made — in the row's
 * tip, because four lines of standing prose above one button is how this screen
 * got unreadable.
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

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { useChainEnvironment } from "@/lib/chain-environment";
import { usePrivyVaultKey } from "@/hooks/use-privy-vault-key";
import { deleteRemoteEnvelope, remoteBackupSaved } from "@/lib/vault-remote";
import { hasDeviceEnvelope } from "@/lib/vault-identity";
import { PinField } from "@/components/vault/pin-field";
import { RowButton, RowNote, Section, SettingsRow } from "@/components/settings/preferences-form";

export function PinBackupSection() {
  const privy = usePrivyVaultKey();
  const { networkId, vaultId } = useChainEnvironment();
  const hasSeed = useUTXOpiaStore((s) => s.vaultSeed !== null);

  const [confirming, setConfirming] = useState(false);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  // localStorage is not readable during render on the server.
  const [saved, setSaved] = useState(false);
  // A login-armed browser keeps no wrapping of its own, so our copy is not a
  // backup here — it is the way in. Deleting it is a different act on this
  // device than on one whose passkey holds a wrapping, and the screen has to
  // say so before the member finds out by reloading.
  const [strands, setStrands] = useState(false);
  useEffect(() => {
    setSaved(remoteBackupSaved({ networkId, vaultId }));
    setStrands(!hasDeviceEnvelope({ networkId, vaultId }));
  }, [networkId, vaultId, done]);

  if (!privy.available || !privy.authenticated || !hasSeed) return null;

  const remove = async () => {
    setError(null);
    setBusy(true);
    try {
      // No signature needed any more: the row is addressed by the account and
      // released against the PIN proof. One fewer prompt for the one action a
      // member takes when they have decided they want us out of it.
      if (!privy.accountId) throw new Error("Sign in first.");
      await deleteRemoteEnvelope({ scope: { networkId, vaultId }, pin, accountId: privy.accountId });
      setConfirming(false);
      setPin("");
      setDone(true);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not delete the copy.");
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <Section label="PIN backup">
        <RowNote>
          Our copy is gone. Your recovery string and this device are the way back in — restoring
          from the string on a new device saves a fresh copy, if you want one again.{" "}
          <button
            type="button"
            onClick={() => setDone(false)}
            className="text-gray-light hover:text-foreground transition-colors cursor-pointer"
          >
            Done
          </button>
        </RowNote>
      </Section>
    );
  }

  // A Delete button standing alone reads as proof a copy exists. It is the one
  // thing this screen was never able to say, and the member who most needs the
  // answer — somebody about to set up a second phone — is the one who cannot
  // find out any other way than by trying it there and failing.
  if (!saved) {
    return (
      <Section label="PIN backup">
        <RowNote>
          No copy saved for this login, so a new device will need your recovery string. Restoring
          from that string with a PIN set saves one.
        </RowNote>
      </Section>
    );
  }

  return (
    <Section label="PIN backup">
      <SettingsRow
        title="Locked copy we hold"
        tip={
          <>
            So a new device does not need your recovery string. We hold the copy and a check of
            your PIN; opening it takes a signature from your login that never reaches us. The PIN
            cannot be changed — delete this copy and save a new one on your next restore.
            Deleting means a new device will need your recovery string again; nothing on this
            device changes.
          </>
        }
        action={
          confirming ? undefined : (
            <RowButton onClick={() => setConfirming(true)} danger>
              Delete
            </RowButton>
          )
        }
      />

      {confirming && (
        <div className="flex flex-col gap-3 py-4 px-1">
          <p className="text-[11px] leading-relaxed text-gray/70">
            Your PIN proves the request is yours. After this we hold nothing — and cannot be made
            to hand over what we do not have.
          </p>

          {strands && (
            <p className="rounded-[10px] border border-red-500/20 bg-red-500/10 p-2.5 text-[11px] leading-relaxed text-red-400">
              This browser has no passkey wrapping of its own — our copy is how it opens this
              vault. Delete it and your recovery string is the only way back in, here and
              everywhere.
            </p>
          )}

          <PinField value={pin} onChange={setPin} label="Your PIN" disabled={busy} autoFocus />

          {error && <span className="text-[11px] leading-relaxed text-red-400/90">{error}</span>}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void remove()}
              disabled={busy || !pin.trim()}
              className={cn(
                "inline-flex min-h-9 flex-1 items-center justify-center rounded-md px-4",
                "border border-red-500/25 text-[11px] font-medium text-red-400 transition-colors cursor-pointer",
                "hover:bg-red-500/10 disabled:cursor-not-allowed disabled:border-gray/15 disabled:text-gray",
              )}
            >
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
              className="px-3 text-[11px] text-gray/50 hover:text-foreground transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </Section>
  );
}
