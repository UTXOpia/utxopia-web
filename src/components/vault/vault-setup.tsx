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

import { useState } from "react";
import { AlertCircle, ArrowLeft, KeyRound, Loader2, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { usePasskey } from "@/hooks/use-passkey";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { PassphraseField } from "@/components/vault/passphrase-field";
import { RecoveryStringCard } from "@/components/vault/recovery-string-card";

type Mode = "choose" | "create" | "restore" | "saved";

export function VaultSetup({ onDone }: { onDone: () => void }) {
  const { register: registerPasskey, authenticate: authenticatePasskey } = usePasskey();
  const createEnvelopeVault = useUTXOpiaStore((s) => s.createEnvelopeVault);
  const restoreEnvelopeVault = useUTXOpiaStore((s) => s.restoreEnvelopeVault);

  const [mode, setMode] = useState<Mode>("choose");
  const [passphrase, setPassphrase] = useState("");
  const [recoveryInput, setRecoveryInput] = useState("");
  const [recoveryString, setRecoveryString] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const handleCreate = () =>
    run(async () => {
      // The passkey both gates this device and supplies the key material its
      // wrapping is encrypted under, so it has to come before the wrapping.
      const deviceKeyMaterial = await registerPasskey();
      if (!deviceKeyMaterial) throw new Error("This device did not provide a passkey.");
      setRecoveryString(await createEnvelopeVault(passphrase, deviceKeyMaterial));
      setPassphrase("");
      setMode("saved");
    });

  const handleRestore = () =>
    run(async () => {
      // Arming this device is optional — a restore that cannot register a
      // passkey should still open the vault for this session rather than fail.
      const deviceKeyMaterial = (await authenticatePasskey().catch(() => null)) ?? undefined;
      await restoreEnvelopeVault(recoveryInput, passphrase, deviceKeyMaterial ?? undefined);
      setPassphrase("");
      setRecoveryInput("");
      onDone();
    });

  if (mode === "saved") {
    return (
      <div className="flex flex-col gap-4">
        <RecoveryStringCard value={recoveryString} onConfirmed={onDone} confirmLabel="Open my vault" />
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
          onClick={() => setMode("create")}
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
