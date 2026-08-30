"use client";

/**
 * What a returning member sees instead of "Create private vault".
 *
 * The seed only ever lives in memory, so every reload lands here — and until
 * now the page could not tell that apart from a first visit, and greeted
 * somebody whose funds were sitting on the other side of a fingerprint with an
 * invitation to start over. The wrapping in localStorage is the tell: it exists
 * only if a vault was set up in this browser.
 *
 * Reopening it needs whichever factor armed this browser — the passkey, or a
 * login signature and a PIN where PRF was unavailable. Both need a gesture, so
 * this is a button rather than something that happens on load.
 */

import { useEffect, useState } from "react";
import Image from "next/image";
import { AlertCircle, Fingerprint, KeyRound, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePasskey } from "@/hooks/use-passkey";
import { LoginRequiredError, useLoginArmed, usePrivyVaultKey } from "@/hooks/use-privy-vault-key";
import { useChainEnvironment } from "@/lib/chain-environment";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { NoDeviceEnvelopeError, hasDeviceEnvelope, readDeviceEnvelope } from "@/lib/vault-identity";
import { getRemoteEnvelope, remoteBackupSaved } from "@/lib/vault-remote";
import { PinField } from "@/components/vault/pin-field";

export function useHasLocalVault(): boolean {
  const { networkId, vaultId } = useChainEnvironment();
  const hasKeys = useUTXOpiaStore((s) => s.hasKeys);
  const [present, setPresent] = useState(false);

  // localStorage is not readable during render on the server, and the answer
  // changes when a vault is created or forgotten in this tab.
  useEffect(() => {
    // A published copy counts as much as a local wrapping. Since a login-armed
    // browser keeps no wrapping, the wrapping alone would send a returning
    // member to "create a new vault" — the one screen whose options are both
    // wrong for somebody whose funds are already on chain.
    setPresent(hasDeviceEnvelope({ networkId, vaultId }) || remoteBackupSaved({ networkId, vaultId }));
  }, [networkId, vaultId, hasKeys]);

  return present;
}

export function VaultUnlockPrompt({
  onSignInInstead,
  onUnlocked,
}: {
  onSignInInstead: () => void;
  /** Rendered inside a dialog, the caller has to dismiss it. */
  onUnlocked?: () => void;
}) {
  const { authenticate, hasCredential: hasPasskey } = usePasskey();
  const { networkId, vaultId } = useChainEnvironment();
  const privy = usePrivyVaultKey();
  // The wrapping alone cannot say what made it, so the signer note is the tell.
  // Offering the wrong one would ask for a factor that was never used here.
  const loginArmed = useLoginArmed();
  const unlockEnvelopeVault = useUTXOpiaStore((s) => s.unlockEnvelopeVault);
  const armThisDeviceWithPasskey = useUTXOpiaStore((s) => s.armThisDeviceWithPasskey);
  const restoreFromLoginEnvelope = useUTXOpiaStore((s) => s.restoreFromLoginEnvelope);
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * The PIN is for a new device. Once one is in hand, the daily unlock belongs
   * to this device's passkey — so hand it over the first time PRF answers here,
   * and this screen stops asking.
   *
   * Best-effort by design: the vault is already open by the time this runs, and
   * a browser that cannot do PRF should keep the PIN rather than see an error
   * for something it did not ask for. Only re-uses a credential this browser
   * already has; minting one is a decision, not a side effect of unlocking.
   */
  const handOverToPasskey = async () => {
    if (!hasPasskey) return;
    try {
      const material = await authenticate({ requirePrf: true });
      if (material) await armThisDeviceWithPasskey(material);
    } catch {
      // Stay on the PIN. Nothing was lost — the wrapping it opens is untouched.
    }
  };

  const unlock = async () => {
    setError(null);
    setBusy(true);
    try {
      if (loginArmed) {
        // Published copy first, and no falling back to a local one when it
        // cannot be reached. The whole point of coming through the blob store
        // is that a wrong PIN spends one of ten tries; a fallback that a
        // dropped connection can trigger hands that back for free.
        //
        // The `saved` branch is also the migration: browsers armed before the
        // local wrapping was dropped still hold one and keep using it, and move
        // over the next time a copy is published or fetched.
        const scope = { networkId, vaultId };
        if (remoteBackupSaved(scope)) {
          if (!privy.accountId) throw new LoginRequiredError();
          // Fetch before signing: the salt the signature is bound to lives in
          // the wrapping this returns, and the counted PIN check is passed here
          // rather than against a tag nobody is counting.
          const envelope = await getRemoteEnvelope({ scope, pin, accountId: privy.accountId });
          const { keyMaterial } = await privy.keyMaterialFor(pin, envelope.kdf.salt);
          await restoreFromLoginEnvelope(envelope, keyMaterial);
        } else {
          // The salt this browser's wrapping was written under is what the
          // signature is bound to, so it has to be read before asking for one.
          const envelope = readDeviceEnvelope(scope);
          if (!envelope) throw new NoDeviceEnvelopeError();
          const { keyMaterial } = await privy.keyMaterialFor(pin, envelope.kdf.salt);
          await unlockEnvelopeVault(keyMaterial, "pin");
        }
        setPin("");
        await handOverToPasskey();
        onUnlocked?.();
      } else {
        // A wrapping only exists here if PRF produced its key, so requiring PRF
        // now turns a browser that quietly lost it into a clear failure rather
        // than an unlock attempt with the wrong key material.
        const deviceKeyMaterial = await authenticate({ requirePrf: true });
        if (!deviceKeyMaterial) throw new Error("That passkey did not unlock this vault.");
        await unlockEnvelopeVault(deviceKeyMaterial);
        onUnlocked?.();
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not unlock this vault.");
    } finally {
      setBusy(false);
    }
  };

  // A login-armed browser whose provider session has lapsed had a PIN field, a
  // signature it could not ask for, and no way back to a sign-in — the unlock
  // just errored. Sign in first, then the same button unlocks.
  const needsLogin = loginArmed && privy.available && privy.ready && !privy.authenticated;

  const Icon = loginArmed ? KeyRound : Fingerprint;

  return (
    <div className="flex flex-col items-center py-6">
      {/* No ring around it: the mark draws its own, and two at this size reads
          as a badge inside a badge. */}
      <Image
        src="/brand/logo-transparent-128.png"
        alt=""
        width={72}
        height={72}
        className="mb-5 object-contain"
      />
      <h1 className="mb-1.5 text-[22px] font-bold text-foreground">Welcome back</h1>
      <p className="mb-6 max-w-[34ch] text-balance text-center text-caption text-gray-light/70">
        Your vault is on this device. Unlock it to see your balance — nothing left this browser.
      </p>

      {error && (
        <div className="mb-4 flex max-w-[34ch] items-start gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <span className="text-caption text-red-400">{error}</span>
        </div>
      )}

      {loginArmed && !needsLogin && (
        <form
          className="mb-4 w-full max-w-[34ch]"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy) void unlock();
          }}
        >
          <PinField value={pin} onChange={setPin} disabled={busy} autoFocus />
        </form>
      )}

      <button
        onClick={needsLogin ? () => void privy.login() : unlock}
        disabled={busy}
        className={cn(
          "inline-flex items-center gap-2 rounded-full px-7 py-3",
          "bg-foreground text-body2 font-semibold text-background transition-all duration-200 cursor-pointer",
          "hover:bg-white hover:shadow-[0_0_24px_rgba(255,255,255,0.12)] active:scale-95",
          "disabled:cursor-not-allowed disabled:bg-gray/25 disabled:text-gray",
        )}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Icon className="h-4 w-4" />}
        {busy ? "Unlocking\u2026" : needsLogin ? "Sign in to unlock" : "Unlock vault"}
      </button>

      <button
        onClick={onSignInInstead}
        className="mt-4 text-caption text-gray/50 hover:text-foreground transition-colors cursor-pointer"
      >
        Use a different vault
      </button>
    </div>
  );
}
