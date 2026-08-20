"use client";

/**
 * Issue a fresh recovery string, and forget this vault on this device.
 *
 * There used to be two export tasks — one under the passphrase already in use,
 * one under a new one — because the string was a ciphertext and the passphrase
 * was its lock. A string now carries its own key, so every issue is a new key
 * and the distinction has nothing left to describe.
 *
 * Issuing is the real safety net in this design: as long as one device still
 * opens, a lost string is an inconvenience rather than a loss. It has to stay
 * findable.
 */

import { useState } from "react";
import { AlertCircle, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { PrfUnavailableError, usePasskey } from "@/hooks/use-passkey";
import { RecoveryStringCard } from "@/components/vault/recovery-string-card";

export function RecoverySection() {
  const hasKeys = useUTXOpiaStore((s) => s.hasKeys);
  const hasSeed = useUTXOpiaStore((s) => s.vaultSeed !== null);
  const exportRecoveryString = useUTXOpiaStore((s) => s.exportRecoveryString);
  const forgetVaultOnThisDevice = useUTXOpiaStore((s) => s.forgetVaultOnThisDevice);
  const { authenticate } = usePasskey();

  const [result, setResult] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!hasKeys) return null;

  // Vaults unlocked through the older passkey or wallet paths have keys but no
  // seed, so there is nothing to wrap. Say that rather than showing a control
  // that cannot work.
  if (!hasSeed) {
    return (
      <section className="flex flex-col gap-2">
        <h2 className="px-1 text-[11px] font-medium uppercase tracking-wider text-gray/50">Recovery</h2>
        <p className="rounded-[12px] border border-gray/15 bg-muted/25 p-4 text-caption leading-relaxed text-gray">
          This vault was unlocked with a passkey or wallet signature, so it has no recovery string.
          Sign in with a recovery-string vault to manage one.
        </p>
      </section>
    );
  }

  const reset = () => {
    setResult("");
    setError(null);
  };

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      // A recovery string is portable, permanent spend authority. Minting one
      // straight off an unlocked tab would turn a few seconds of physical
      // access into forever, with nothing on screen to notice afterwards — so
      // the passkey answers again first.
      const deviceKeyMaterial = await authenticate({ requirePrf: true }).catch((caught) => {
        if (caught instanceof PrfUnavailableError) return undefined;
        throw caught;
      });
      setResult(await exportRecoveryString(deviceKeyMaterial ?? undefined));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build a recovery string.");
    } finally {
      setBusy(false);
    }
  };

  const forget = async () => {
    setError(null);
    setBusy(true);
    try {
      await forgetVaultOnThisDevice();
      reset();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not forget this vault.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="flex flex-col gap-2">
      <h2 className="px-1 text-[11px] font-medium uppercase tracking-wider text-gray/50">Recovery</h2>

      {result ? (
        <div className="flex flex-col gap-3">
          <RecoveryStringCard value={result} />
          <div className="flex items-start gap-2 rounded-[10px] border border-warning/25 bg-warning/5 p-3">
            <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
            <p className="text-caption leading-relaxed text-gray">
              <span className="font-semibold text-foreground">Every string you have issued still
              works.</span>{" "}
              Each carries its own key and a string already written down cannot be revoked. If you
              think an old one leaked, move your funds to a new vault — nothing else retires it.
            </p>
          </div>
          <button
            type="button"
            onClick={reset}
            className="self-start text-caption text-gray/50 hover:text-foreground transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          {error && (
            <div className="flex items-start gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
              <span className="text-caption text-red-400">{error}</span>
            </div>
          )}
          <SettingsAction
            title={busy ? "Working…" : "Issue a recovery string"}
            detail="A fresh one, with its own key. Keep it somewhere only you can read."
            onClick={() => void run()}
          />
          <SettingsAction
            title="Forget this vault on this device"
            detail="Your recovery string becomes the only way back in, here and anywhere."
            onClick={forget}
            danger
          />
        </div>
      )}
    </section>
  );
}

export function SettingsAction({
  title,
  detail,
  onClick,
  danger,
}: {
  title: string;
  detail: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[52px] flex-col justify-center rounded-[12px] border px-4 py-2.5",
        "transition-colors cursor-pointer text-left",
        danger
          ? "border-red-500/20 bg-red-500/5 hover:bg-red-500/10"
          : "border-gray/15 bg-muted/25 hover:bg-muted/50",
      )}
    >
      <span className={cn("text-body2-semibold", danger ? "text-red-400" : "text-foreground")}>{title}</span>
      <span className="text-caption text-gray/60">{detail}</span>
    </button>
  );
}
