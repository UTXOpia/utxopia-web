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
 * findable — which is why it is a row in the same list as everything else and
 * not a card shouting beside them.
 */

import { useState } from "react";
import { ShieldAlert } from "lucide-react";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { PrfUnavailableError, usePasskey } from "@/hooks/use-passkey";
import { RecoveryStringCard } from "@/components/vault/recovery-string-card";
import { RowButton, RowNote, Section, SettingsRow } from "@/components/settings/preferences-form";

export function RecoverySection() {
  const hasKeys = useUTXOpiaStore((s) => s.hasKeys);
  const hasSeed = useUTXOpiaStore((s) => s.vaultSeed !== null);
  const exportRecoveryString = useUTXOpiaStore((s) => s.exportRecoveryString);
  const forgetVaultOnThisDevice = useUTXOpiaStore((s) => s.forgetVaultOnThisDevice);
  const { authenticate } = usePasskey();

  const [result, setResult] = useState("");
  const [busy, setBusy] = useState<"issue" | "forget" | null>(null);
  const [error, setError] = useState<string | null>(null);

  if (!hasKeys) return null;

  // Vaults unlocked through the older passkey or wallet paths have keys but no
  // seed, so there is nothing to wrap. Say that rather than showing a control
  // that cannot work.
  if (!hasSeed) {
    return (
      <Section label="Recovery">
        <RowNote>
          This vault was unlocked with a passkey or wallet signature, so it has no recovery string.
          Sign in with a recovery-string vault to manage one.
        </RowNote>
      </Section>
    );
  }

  const run = async () => {
    setError(null);
    setBusy("issue");
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
      setBusy(null);
    }
  };

  const forget = async () => {
    setError(null);
    setBusy("forget");
    try {
      await forgetVaultOnThisDevice();
      setResult("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not forget this vault.");
    } finally {
      setBusy(null);
    }
  };

  if (result) {
    return (
      <Section label="Recovery">
        <div className="flex flex-col gap-3 py-4">
          <RecoveryStringCard value={result} />
          <div className="flex items-start gap-2 px-1">
            <ShieldAlert className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden />
            <p className="text-[11px] leading-relaxed text-gray/70">
              <span className="text-gray-light">Every string you have issued still works.</span>{" "}
              Each carries its own key and one already written down cannot be revoked. If you think
              an old one leaked, move your funds to a new vault — nothing else retires it.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setResult("")}
            className="self-start px-1 text-[11px] text-gray/50 hover:text-foreground transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      </Section>
    );
  }

  return (
    <Section label="Recovery">
      <SettingsRow
        title="Recovery string"
        tip="A fresh string, with its own key — the way back into this vault from any device. Keep it somewhere only you can read. Issuing one does not retire the ones you already have."
        action={
          <RowButton onClick={() => void run()} busy={busy === "issue"} disabled={busy !== null}>
            Issue
          </RowButton>
        }
      />
      <SettingsRow
        title="This vault on this device"
        tip="Removes the wrapping this browser holds. Your funds are untouched, but your recovery string becomes the only way back in — here and anywhere."
        action={
          <RowButton onClick={() => void forget()} busy={busy === "forget"} disabled={busy !== null} danger>
            Forget
          </RowButton>
        }
      />
      {error && <RowNote tone="error">{error}</RowNote>}
    </Section>
  );
}
