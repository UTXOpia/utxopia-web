"use client";

/**
 * Re-export the recovery string, and change the passphrase that locks it.
 *
 * Both need the member's passphrase, and neither is reachable without an
 * unlocked vault — the seed lives in memory for exactly this, so nobody has to
 * run an unlock ceremony twice to write their string down again.
 *
 * Re-exporting is the real safety net in this design: as long as one device
 * still opens, a lost string is an inconvenience rather than a loss. It has to
 * stay findable.
 */

import { useState } from "react";
import { AlertCircle, Loader2, RotateCcw, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { PassphraseField } from "@/components/vault/passphrase-field";
import { RecoveryStringCard } from "@/components/vault/recovery-string-card";

type Task = "idle" | "export" | "change";

export function RecoverySection() {
  const hasKeys = useUTXOpiaStore((s) => s.hasKeys);
  const hasSeed = useUTXOpiaStore((s) => s.vaultSeed !== null);
  const exportRecoveryString = useUTXOpiaStore((s) => s.exportRecoveryString);

  const [task, setTask] = useState<Task>("idle");
  const [passphrase, setPassphrase] = useState("");
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
    setTask("idle");
    setPassphrase("");
    setResult("");
    setError(null);
  };

  const run = async () => {
    setError(null);
    setBusy(true);
    try {
      setResult(await exportRecoveryString(passphrase));
      setPassphrase("");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Could not build a recovery string.");
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
          {task === "change" && (
            <div className="flex items-start gap-2 rounded-[10px] border border-warning/25 bg-warning/5 p-3">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden />
              <p className="text-caption leading-relaxed text-gray">
                <span className="font-semibold text-foreground">Your old string still works.</span>{" "}
                Anyone holding it, with the old passphrase, can still open this vault — a string
                already written down cannot be revoked. If you think the old one leaked, move your
                funds to a new vault instead.
              </p>
            </div>
          )}
          <button
            type="button"
            onClick={reset}
            className="self-start text-caption text-gray/50 hover:text-foreground transition-colors cursor-pointer"
          >
            Done
          </button>
        </div>
      ) : task === "idle" ? (
        <div className="flex flex-col gap-2">
          <SettingsAction
            title="Show my recovery string"
            detail="Write it down again, or move it to a new password manager."
            onClick={() => setTask("export")}
          />
          <SettingsAction
            title="Change my passphrase"
            detail="Issues a new string. The old one keeps working."
            onClick={() => setTask("change")}
          />
        </div>
      ) : (
        <div className="flex flex-col gap-3 rounded-[12px] border border-gray/15 bg-muted/25 p-4">
          <p className="text-caption leading-relaxed text-gray">
            {task === "export"
              ? "Choose the passphrase that will lock this string. It can be the one you already use, or a new one — whatever you pick here is what unlocks this copy."
              : "Choose a new passphrase. It will lock the new string — your vault, address and balance do not change."}
          </p>

          {/* Both tasks choose the lock on a string that is about to exist, so
              both get the generator and the strength read-out. Nothing is being
              verified against — there is no stored copy to check a passphrase
              against, by design. */}
          <PassphraseField
            value={passphrase}
            onChange={setPassphrase}
            label={task === "export" ? "Passphrase for this string" : "New passphrase"}
            disabled={busy}
            autoFocus
          />

          {error && (
            <div className="flex items-start gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-2.5">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
              <span className="text-caption text-red-400">{error}</span>
            </div>
          )}

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={run}
              disabled={busy || !passphrase}
              className={cn(
                "inline-flex min-h-10 flex-1 items-center justify-center gap-2 rounded-[10px] px-4",
                "bg-foreground text-caption font-semibold text-background transition-colors cursor-pointer",
                "hover:bg-white disabled:cursor-not-allowed disabled:bg-gray/25 disabled:text-gray",
              )}
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <RotateCcw className="h-4 w-4" aria-hidden />}
              {task === "export" ? "Show string" : "Change passphrase"}
            </button>
            <button
              type="button"
              onClick={reset}
              disabled={busy}
              className="min-h-10 rounded-[10px] px-3 text-caption text-gray/60 hover:text-foreground transition-colors cursor-pointer"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function SettingsAction({
  title,
  detail,
  onClick,
}: {
  title: string;
  detail: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "flex min-h-[52px] flex-col justify-center rounded-[12px] border border-gray/15 px-4 py-2.5",
        "bg-muted/25 hover:bg-muted/50 transition-colors cursor-pointer text-left",
      )}
    >
      <span className="text-body2-semibold text-foreground">{title}</span>
      <span className="text-caption text-gray/60">{detail}</span>
    </button>
  );
}
