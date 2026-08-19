"use client";

/**
 * Create a vault, or restore one onto this device.
 *
 * The fork at the top is deliberate and cannot be skipped. Nothing on this
 * device or on any server knows whether this member already has a vault — that
 * is the price of keeping the wrapping off our infrastructure — so guessing
 * would eventually mean opening a second identity for somebody who already had
 * one, letting them deposit into it, and leaving them certain their first vault
 * had been robbed.
 */

import { useMemo, useState } from "react";
import { AlertCircle, ArrowLeft, KeyRound, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrfUnavailableError, usePasskey } from "@/hooks/use-passkey";
import { usePrivyVaultKey } from "@/hooks/use-privy-vault-key";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hasDeviceEnvelope } from "@/lib/vault-identity";
import { PassphraseField } from "@/components/vault/passphrase-field";
import { PinField } from "@/components/vault/pin-field";
import { RecoveryStringCard } from "@/components/vault/recovery-string-card";

type Mode = "choose" | "create" | "restore" | "saved" | "confirm-replace";

export function VaultSetup({ onDone }: { onDone: () => void }) {
  const { register: registerPasskey, authenticate: authenticatePasskey, hasCredential: hasPasskeyCredential } = usePasskey();
  const { networkId, vaultId } = useChainEnvironment();
  const alreadyHere = useMemo(
    () => hasDeviceEnvelope({ networkId, vaultId }),
    [networkId, vaultId],
  );
  const privy = usePrivyVaultKey();
  const createEnvelopeVault = useUTXOpiaStore((s) => s.createEnvelopeVault);
  const restoreEnvelopeVault = useUTXOpiaStore((s) => s.restoreEnvelopeVault);
  const verifyRecoveryString = useUTXOpiaStore((s) => s.verifyRecoveryString);

  const [mode, setMode] = useState<Mode>("choose");
  const [passphrase, setPassphrase] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryString, setRecoveryString] = useState("");
  const [confirmPassphrase, setConfirmPassphrase] = useState("");
  const [pin, setPin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const run = async (work: () => Promise<void>) => {
    setError(null);
    setBusy(true);
    try {
      await work();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  };

  /**
   * Key material for this device's wrapping, preferring the passkey.
   *
   * PRF's absence is only discoverable by asking, so the fallback lives here
   * rather than in a branch chosen up front. Where the browser cannot do PRF, a
   * login signature and a PIN wrap the same seed — the alternative is what this
   * used to do: leave the device with no wrapping at all and send the member
   * back to their recovery string on every visit, which is how a string that
   * should be written down once ends up in a notes app.
   *
   * Still optional. A member who gives no PIN gets the old behaviour and an
   * honest notice, not a wrapping under something they did not choose.
   */
  const armingMaterial = async (
    ask: (opts: { requirePrf: true }) => Promise<Uint8Array | null>,
  ): Promise<{ material?: Uint8Array; signer?: string }> => {
    try {
      const material = await ask({ requirePrf: true });
      if (material) return { material };
    } catch (caught) {
      if (!(caught instanceof PrfUnavailableError)) throw caught;
      setNotice(caught.message);
    }
    if (!privy.available || !pin.trim()) return {};
    const { keyMaterial, signer } = await privy.keyMaterialFor(pin);
    setNotice(null);
    return { material: keyMaterial, signer };
  };

  const handleCreate = () =>
    run(async () => {
      // The passkey both gates this device and supplies the key material its
      // wrapping is encrypted under, so it has to come before the wrapping.
      // requirePrf: without it this hook hands back a seed whose encryption key
      // is rebuildable from plaintext localStorage, which would wrap the vault
      // seed under something already lying beside the ciphertext.
      //
      // Reuse an existing credential rather than minting a second one:
      // registering re-points the stored credential id, and every wrapping
      // already on this device — the other vault, other networks, any legacy
      // identity — was sealed under the first credential's PRF output.
      const askDevice = hasPasskeyCredential ? authenticatePasskey : registerPasskey;
      const { material, signer } = await armingMaterial(askDevice);
      setRecoveryString(
        await createEnvelopeVault(passphrase, material, { replaceExisting: alreadyHere }),
      );
      // Only once the wrapping it describes exists.
      if (signer) privy.remember(signer);
      setPassphrase("");
      setPin("");
      setMode("saved");
    });

  const handleRestore = () =>
    run(async () => {
      // Arming this device is optional — a restore that cannot do it safely
      // should still open the vault for this session rather than fail, and
      // should say why the next visit will ask again.
      const { material, signer } = await armingMaterial(authenticatePasskey);
      await restoreEnvelopeVault(recoveryInput, passphrase, material);
      if (signer) privy.remember(signer);
      setPassphrase("");
      setPin("");
      setRecoveryInput("");
      onDone();
    });

  // Nothing anywhere stores a verifier, so a typo in the passphrase would stay
  // invisible until a restore months later, with no old device left to fall
  // back on. Typing it back here proves the pair opens, at the one moment it
  // still costs nothing to find out.
  const handleConfirm = () =>
    run(async () => {
      await verifyRecoveryString(recoveryString, confirmPassphrase);
      setConfirmPassphrase("");
      onDone();
    });

  if (mode === "saved") {
    return (
      <div className="flex flex-col gap-3">
        {notice && <Notice text={notice} />}
        <RecoveryStringCard value={recoveryString} />

        <div className="flex flex-col gap-2.5 rounded-[12px] border border-gray/15 bg-muted/25 p-4">
          <p className="text-caption leading-relaxed text-gray">
            <span className="font-semibold text-foreground">Now prove it opens.</span> Type your
            passphrase once more. Nobody stores it, so this is the only chance to find out you saved
            the right one.
          </p>

          <PassphraseField
            value={confirmPassphrase}
            onChange={setConfirmPassphrase}
            label="Passphrase"
            verifyOnly
            autoFocus
            disabled={busy}
          />

          {error && (
            <div className="flex items-start gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
              <span className="text-caption text-red-400">{error}</span>
            </div>
          )}

          <button
            type="button"
            onClick={handleConfirm}
            disabled={busy || !confirmPassphrase}
            className={cn(
              "flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-4",
              "bg-foreground text-body2 font-semibold text-background transition-colors cursor-pointer",
              "hover:bg-white disabled:cursor-not-allowed disabled:bg-gray/25 disabled:text-gray",
            )}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {busy ? "Checking…" : "Open my vault"}
          </button>
        </div>
      </div>
    );
  }

  if (mode === "choose") {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="px-1 text-caption leading-relaxed text-gray">
          Your vault lives on this device and in a recovery string you keep. Nothing about it is
          stored on our servers, so we cannot tell whether you already have one.
        </p>
        <button
          type="button"
          onClick={() => setMode(alreadyHere ? "confirm-replace" : "create")}
          className={cn(
            "flex min-h-[52px] items-center gap-3 rounded-[12px] border border-gray/20 px-4",
            "bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer text-left",
          )}
        >
          <KeyRound className="h-4 w-4 shrink-0 text-privacy" aria-hidden />
          <span>
            <span className="block text-body2-semibold text-foreground">Create a new vault</span>
            <span className="block text-caption text-gray/60">First time here</span>
          </span>
        </button>
        <button
          type="button"
          onClick={() => setMode("restore")}
          className={cn(
            "flex min-h-[52px] items-center gap-3 rounded-[12px] border border-gray/20 px-4",
            "bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer text-left",
          )}
        >
          <RotateCcw className="h-4 w-4 shrink-0 text-btc" aria-hidden />
          <span>
            <span className="block text-body2-semibold text-foreground">Restore an existing vault</span>
            <span className="block text-caption text-gray/60">I have a recovery string</span>
          </span>
        </button>
      </div>
    );
  }

  // Creating over an existing wrapping destroys the only copy of that vault
  // this browser holds. Nothing warned about it before: "Create a new vault"
  // sat first on the list, and the AuthModal opens itself on several routes.
  if (mode === "confirm-replace") {
    return (
      <div className="flex flex-col gap-3.5">
        <div className="flex items-start gap-2 rounded-[12px] border border-red-500/25 bg-red-500/5 p-4">
          <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <div>
            <p className="text-caption font-semibold text-foreground">
              This browser already holds a vault
            </p>
            <p className="mt-1 text-caption leading-relaxed text-gray">
              Creating a new one replaces it here. If you have not saved that vault&apos;s recovery
              string somewhere else, everything in it becomes unreachable — from this device and
              every other one.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={() => setMode("restore")}
          className={cn(
            "flex min-h-11 items-center justify-center rounded-[10px] px-4",
            "bg-foreground text-body2 font-semibold text-background transition-colors cursor-pointer hover:bg-white",
          )}
        >
          Restore that vault instead
        </button>
        <button
          type="button"
          onClick={() => setMode("create")}
          className="text-caption text-red-400/80 hover:text-red-400 transition-colors cursor-pointer"
        >
          I have its recovery string saved — replace it
        </button>
        <button
          type="button"
          onClick={() => setMode("choose")}
          className="text-caption text-gray/50 hover:text-foreground transition-colors cursor-pointer"
        >
          Back
        </button>
      </div>
    );
  }

  const creating = mode === "create";

  return (
    <div className="flex flex-col gap-3.5">
      <button
        type="button"
        onClick={() => {
          setMode("choose");
          setError(null);
        }}
        className="flex items-center gap-1 self-start text-caption text-gray/50 hover:text-foreground transition-colors cursor-pointer"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back
      </button>

      {!creating && (
        <div className="flex flex-col gap-1.5">
          <label htmlFor="recovery-string" className="px-1 text-[11px] uppercase tracking-wider text-gray/50 font-medium">
            Recovery string
          </label>
          <textarea
            id="recovery-string"
            value={recoveryInput}
            onChange={(e) => setRecoveryInput(e.target.value)}
            rows={3}
            spellCheck={false}
            autoComplete="off"
            placeholder="utxovault1…"
            className={cn(
              "w-full resize-none rounded-[10px] border border-gray/20 bg-muted/40 px-3 py-2.5",
              "font-mono text-[12px] leading-relaxed text-foreground placeholder:text-gray/35",
              "focus:border-privacy/50 focus:outline-none focus:ring-1 focus:ring-privacy/30",
            )}
          />
        </div>
      )}

      <PassphraseField
        value={passphrase}
        onChange={setPassphrase}
        verifyOnly={!creating}
        autoFocus={creating}
        disabled={busy}
      />

      {creating && (
        <p className="px-1 text-caption leading-relaxed text-gray/60">
          This passphrase is the only lock on your recovery string, and it is not stored anywhere.
          If you forget it, the string alone will not get you back in.
        </p>
      )}

      {/* Only once signed in: an unauthenticated field would have to start a
          login from inside the ceremony, and the attempt that triggered it has
          already failed by the time the member finishes. */}
      {privy.authenticated && (
        <PinField
          value={pin}
          onChange={setPin}
          disabled={busy}
          label="PIN (optional)"
          hint="Only used if this device cannot do passkeys. Your login plus this PIN reopens the vault here — it is not a second lock on your recovery string."
        />
      )}

      {notice && <Notice text={notice} />}

      {error && (
        <div className="flex items-start gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-2.5">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <span className="text-caption text-red-400">{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={creating ? handleCreate : handleRestore}
        disabled={busy || !passphrase || (!creating && !recoveryInput.trim())}
        className={cn(
          "flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-4",
          "bg-foreground text-body2 font-semibold text-background transition-colors cursor-pointer",
          "hover:bg-white disabled:cursor-not-allowed disabled:bg-gray/25 disabled:text-gray",
        )}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {busy
          ? creating
            ? "Creating…"
            : "Unlocking…"
          : creating
            ? "Create vault"
            : "Restore vault"}
      </button>
    </div>
  );
}

/** A limitation of this browser, not an error the member caused. */
function Notice({ text }: { text: string }) {
  return (
    <div className="flex items-start gap-2 rounded-[10px] border border-warning/25 bg-warning/5 p-2.5">
      <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
      <span className="text-caption leading-relaxed text-gray">{text}</span>
    </div>
  );
}
