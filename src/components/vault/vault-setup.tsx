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
import { AlertCircle, ArrowLeft, Fingerprint, KeyRound, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { PrfUnavailableError, usePasskey } from "@/hooks/use-passkey";
import { usePrivyVaultKey } from "@/hooks/use-privy-vault-key";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hasDeviceEnvelope } from "@/lib/vault-identity";
import { canWriteRemoteBackup, getRemoteEnvelope, putRemoteEnvelope } from "@/lib/vault-remote";
import { newSalt } from "@/lib/vault-envelope";
import { PinField } from "@/components/vault/pin-field";
import { RecoveryStringCard } from "@/components/vault/recovery-string-card";

type Mode = "choose" | "create" | "restore" | "unlock-login" | "saved" | "confirm-replace";

export function VaultSetup({
  onDone,
  onBack,
}: {
  onDone: () => void;
  /** Out of this flow entirely, back to whatever offered it. */
  onBack?: () => void;
}) {
  const { register: registerPasskey, authenticate: authenticatePasskey, hasCredential: hasPasskeyCredential } = usePasskey();
  const { networkId, vaultId } = useChainEnvironment();
  const alreadyHere = useMemo(
    () => hasDeviceEnvelope({ networkId, vaultId }),
    [networkId, vaultId],
  );
  const privy = usePrivyVaultKey();
  const createEnvelopeVault = useUTXOpiaStore((s) => s.createEnvelopeVault);
  const restoreEnvelopeVault = useUTXOpiaStore((s) => s.restoreEnvelopeVault);
  const sealLoginEnvelope = useUTXOpiaStore((s) => s.sealLoginEnvelope);
  const restoreFromLoginEnvelope = useUTXOpiaStore((s) => s.restoreFromLoginEnvelope);
  const armThisDeviceWithPasskey = useUTXOpiaStore((s) => s.armThisDeviceWithPasskey);
  const scope = useMemo(() => ({ networkId, vaultId }), [networkId, vaultId]);

  const [mode, setMode] = useState<Mode>("choose");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryString, setRecoveryString] = useState("");
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
   * This device's daily wrapping. PRF or nothing.
   *
   * PRF's absence is only discoverable by asking, so this reports it rather
   * than branching up front. Returning nothing is a real outcome: a browser
   * that cannot do PRF gets its wrapping from the login instead, and the caller
   * decides that, because the login now has a second job this function has no
   * business knowing about.
   */
  const deviceMaterial = async (
    ask: (opts: { requirePrf: true }) => Promise<Uint8Array | null>,
  ): Promise<Uint8Array | undefined> => {
    try {
      return (await ask({ requirePrf: true })) ?? undefined;
    } catch (caught) {
      if (!(caught instanceof PrfUnavailableError)) throw caught;
      setNotice(caught.message);
      return undefined;
    }
  };

  /**
   * The login wrapping — one signature, one PIN.
   *
   * This used to run only where PRF was missing, as this browser's fallback.
   * It is no longer about this browser: its ciphertext is what a device that
   * has never seen this vault downloads and opens, so it has to be built on
   * every device including the ones whose passkey works. Skipping it on a
   * PRF-capable browser is what left the recovery string as the only way onto
   * a second device.
   *
   * Still optional. No login or no PIN and the member keeps exactly the old
   * behaviour, with the string as their only portable key.
   */
  const loginMaterial = async (salt: Uint8Array) => {
    if (!privy.available || !pin.trim()) return null;
    const material = await privy.keyMaterialFor(pin, salt);
    setNotice(null);
    return { ...material, salt };
  };

  /**
   * Publish it. Best-effort on purpose: the vault exists, the recovery string
   * is already in the member's hands, and failing the whole ceremony over a
   * backup would trade a working vault for a convenience. What it must not do
   * is fail quietly — a member who believes this landed will not write the
   * string down.
   */
  const publishLogin = async (
    login: { keyMaterial: Uint8Array; salt: Uint8Array } | null,
    device?: Uint8Array,
  ): Promise<boolean> => {
    // Said before the generic failure below, because the cause and the fix are
    // completely different: nothing is wrong with the member's PIN or their
    // connection, they are simply on an origin whose vault is not the one the
    // row describes.
    if (!canWriteRemoteBackup()) {
      setNotice(
        "This is a preview or a different address, so no copy was saved — a saved copy belongs to one address. Set your PIN on app.utxopia.com. Keep the recovery string below either way.",
      );
      return false;
    }
    if (!login || !privy.accountId) {
      // The silent branch, and the expensive one: no PIN means no copy, which
      // is indistinguishable on screen from a copy that saved. The member finds
      // out on their next phone, with their funds on the other side of it.
      setNotice("No PIN set, so nothing was saved for this login. A new device will need the recovery string below.");
      return false;
    }
    // `sealLoginEnvelope` refuses to mint portable authority on a
    // passkey-armed device without the passkey answering. Here it just did,
    // moments ago, so hand that answer along rather than asking twice.
    const envelope = await sealLoginEnvelope(login.keyMaterial, login.salt, device);
    const saved = await putRemoteEnvelope({
      scope,
      pin,
      accountId: privy.accountId,
      envelope,
    });
    if (!saved) {
      // Almost always one cause, and it deserves naming: a copy is already
      // saved for this login under a different PIN, which happens to everyone
      // who replaces a vault. The row is only released against a proof of the
      // PIN it was written under, so the way past it is to delete that copy —
      // and a member told only "could not save" goes looking at their network
      // instead, or gives up on a path that is two steps away.
      setNotice(
        "We could not save your PIN backup. If this login already has one under a different PIN, delete it under PIN backup in Settings, then restore from the recovery string below to save a new one. Until then a new device will need that string.",
      );
      return false;
    }
    return true;
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
      const device = await deviceMaterial(askDevice);
      // Minted before the signature, because the signature is over it: the
      // published wrapping is sealed under this exact salt, or the key the
      // login just produced does not open it.
      const salt = newSalt();
      const login = await loginMaterial(salt);
      // No local wrapping under the login. The published copy is the only one,
      // because it is the only one whose PIN tries are counted; a second copy
      // here would leave six digits in storage with no limiter in front.
      setRecoveryString(await createEnvelopeVault(device, { replaceExisting: alreadyHere }));
      // The signer note is what makes the unlock screen ask for a PIN, so it
      // goes only once there is a published copy for that PIN to open. A
      // failed publish leaves this browser un-armed and the next visit on the
      // setup screen, where the recovery string re-publishes.
      if ((await publishLogin(login, device)) && !device && login) privy.remember(login.signer);
      setPin("");
      setMode("saved");
    });

  const handleRestore = () =>
    run(async () => {
      // Arming this device is optional — a restore that cannot do it safely
      // should still open the vault for this session rather than fail, and
      // should say why the next visit will ask again.
      const device = await deviceMaterial(authenticatePasskey);
      const salt = newSalt();
      const login = await loginMaterial(salt);
      await restoreEnvelopeVault(recoveryInput, device);
      // A restore is the moment the string was needed. Publishing here is what
      // stops it being needed again on the next device. Same rule as create:
      // the note only once the copy it points at exists.
      if ((await publishLogin(login, device)) && !device && login) privy.remember(login.signer);
      setPin("");
      setRecoveryInput("");
      onDone();
    });

  /**
   * A device that has never seen this vault, without the recovery string.
   *
   * The PIN does two separate things here and the order matters. It proves out
   * against the blob store first, which is the only counted check a six-digit
   * secret ever gets; only then does it derive the key that opens what came
   * back, which nothing on our side can do. A wrong PIN therefore spends one of
   * ten tries rather than one of a million.
   */
  const handleLoginUnlock = () =>
    run(async () => {
      if (!privy.accountId) throw new Error("Sign in first, then unlock with your PIN.");
      // Fetch before signing, and in that order for a reason: the message the
      // signature is bound to carries this wrapping's salt, and the salt is
      // inside the wrapping. The PIN gate is passed before the provider is
      // asked for anything.
      const envelope = await getRemoteEnvelope({ scope, pin, accountId: privy.accountId });
      const { keyMaterial, signer } = await privy.keyMaterialFor(pin, envelope.kdf.salt);
      // Open the vault before going anywhere near the passkey. `authenticate`
      // runs a full WebAuthn ceremony with userVerification "required" before
      // it can discover PRF is missing, so on the browsers this screen exists
      // for it raises an OS prompt that opens nothing — and until now it did so
      // between the fetch and the restore, where an unanswered prompt left the
      // member on "Unlocking…" with a vault that had already been released to
      // them. The unlock screen has always had this order; this one did not.
      //
      // No `?? keyMaterial` fallback either. A browser without PRF now keeps no
      // wrapping at all and comes back through the blob store every time, which
      // is the only path where a wrong PIN costs the attacker something.
      // getRemoteEnvelope records that a copy exists, so the next visit knows to
      // come back here rather than look for a wrapping that is not there.
      await restoreFromLoginEnvelope(envelope, keyMaterial);
      privy.remember(signer);
      setPin("");
      onDone();

      // An upgrade, not a step. Nothing below can fail the unlock that already
      // happened, so it is deliberately not awaited before onDone.
      void (async () => {
        const device = await deviceMaterial(authenticatePasskey).catch(() => undefined);
        if (device) await armThisDeviceWithPasskey(device);
      })();
    });

  if (mode === "saved") {
    return (
      <div className="flex flex-col gap-3">
        {notice && <Notice text={notice} />}
        {/*
          A reminder, not a test. Typing a passphrase back used to prove
          something real — argon2 either reproduced the key or it did not — and
          there is nothing like that left to prove: the string carries its own
          key, so it is either saved or it is not. Asking somebody to paste back
          what is still on screen above measures only whether they can copy from
          a box we are showing them, and buys the appearance of a check.
          The card's own acknowledgement is honest about being one.
        */}
        <RecoveryStringCard
          value={recoveryString}
          onConfirmed={onDone}
          confirmLabel="Open vault"
        />
      </div>
    );
  }

  if (mode === "choose") {
    return (
      <div className="flex flex-col gap-2.5">
        <p className="px-1 text-caption leading-relaxed text-gray">
          Your vault lives on this device and in a recovery string you keep. Set a PIN and we also
          hold a locked copy — we keep a check of the PIN, never the PIN itself, and opening the
          copy still takes a signature from your login that we never see. We still cannot tell
          whether you already have a vault.
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
        {/* Not gated on being signed in. A member on a new phone has not logged
            in yet, so gating this left them the two options that are both wrong
            for them — start over, or produce the string they came here to
            avoid. Signing in is a step on the next screen, not a price of
            seeing that the door exists. */}
        {privy.available && (
          <button
            type="button"
            onClick={() => setMode("unlock-login")}
            className={cn(
              "flex min-h-[52px] items-center gap-3 rounded-[12px] border border-gray/20 px-4",
              "bg-muted/30 hover:bg-muted/60 transition-colors cursor-pointer text-left",
            )}
          >
            <Fingerprint className="h-4 w-4 shrink-0 text-privacy" aria-hidden />
            <span>
              <span className="block text-body2-semibold text-foreground">Unlock with my PIN</span>
              <span className="block text-caption text-gray/60">
                New device — this login and the PIN you chose
              </span>
            </span>
          </button>
        )}
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className="mt-1 self-center text-caption text-gray/50 hover:text-foreground transition-colors cursor-pointer"
          >
            Back
          </button>
        )}
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

  // A new device, with nothing on it. Only the PIN is asked for: the recovery
  // string is the other path off this screen, not a second field on this one.
  if (mode === "unlock-login") {
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

        <p className="px-1 text-caption leading-relaxed text-gray">
          We hold a locked copy of your vault for this login. Your PIN is what we check before
          handing it over; the signature that actually opens it never reaches us. It takes both,
          which is why neither of us can do this alone.
        </p>

        <form
          className="flex flex-col gap-3.5"
          onSubmit={(e) => {
            e.preventDefault();
            if (!busy && pin.trim()) void handleLoginUnlock();
          }}
        >
          <PinField value={pin} onChange={setPin} disabled={busy || !privy.authenticated} autoFocus />

          {notice && <Notice text={notice} />}

          {error && (
            <div className="flex items-start gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
              <span className="text-caption text-red-400">{error}</span>
            </div>
          )}

          <button
            type={privy.authenticated ? "submit" : "button"}
            onClick={privy.authenticated ? undefined : () => privy.login()}
            disabled={busy || (privy.authenticated && !pin.trim())}
            className={cn(
              "flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-4",
              "bg-foreground text-body2 font-semibold text-background transition-colors cursor-pointer",
              "hover:bg-white disabled:cursor-not-allowed disabled:bg-gray/25 disabled:text-gray",
            )}
          >
            {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
            {!privy.authenticated ? "Sign in to continue" : busy ? "Unlocking…" : "Unlock vault"}
          </button>
        </form>

        <p className="px-1 text-caption leading-relaxed text-gray/60">
          Ten wrong PINs lock this login out for a day. Your recovery string still works.
        </p>
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
            placeholder="utxovault2…"
            className={cn(
              "w-full resize-none rounded-[10px] border border-gray/20 bg-muted/40 px-3 py-2.5",
              "font-mono text-[12px] leading-relaxed text-foreground placeholder:text-gray/35",
              "focus:border-privacy/50 focus:outline-none focus:ring-1 focus:ring-privacy/30",
            )}
          />
        </div>
      )}

      {creating && (
        <p className="px-1 text-caption leading-relaxed text-gray/60">
          We will give you one recovery string. It carries its own key, so it is the only thing you
          have to keep — and anyone who reads it can open this vault, the way a seed phrase always
          has been.
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
          label="PIN — opens this vault on a new device"
          // Permanence belongs on the screen where it is chosen, not on the one
          // where somebody goes looking for a control that is not there. It is
          // not enforced by a missing button — it falls out of the design: the
          // wrapping is sealed under this PIN and the row is released against a
          // proof of it, so replacing it takes the old one, and there is
          // deliberately nothing that lets a stolen session skip that.
          hint="Optional, and the only thing that makes a second device possible without your recovery string. Choose carefully — there is no way to change it later. This is how you open the vault on a new device. We hold a locked copy and a check of this PIN, never the PIN itself and never the signature that opens the copy."
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
        disabled={busy || (!creating && !recoveryInput.trim())}
        className={cn(
          "flex min-h-11 items-center justify-center gap-2 rounded-[10px] px-4",
          "bg-foreground text-body2 font-semibold text-background transition-colors cursor-pointer",
          "hover:bg-white disabled:cursor-not-allowed disabled:bg-gray/25 disabled:text-gray",
        )}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {busy ? (creating ? "Creating…" : "Unlocking…") : creating ? "Create vault" : "Restore vault"}
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
