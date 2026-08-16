"use client";

// Shown once, at the only moment the member can still act on it. The copy says
// the three things that decide whether they will ever get back in: it is the
// only route to a new device, it needs the passphrase to be worth anything, and
// nobody can reissue it.

import { useState } from "react";
import { Check, Copy, KeyRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { notifyCopied } from "@/lib/notifications";

interface RecoveryStringCardProps {
  value: string;
  /** Omit to render as a plain reference (settings), rather than a gate. */
  onConfirmed?: () => void;
  confirmLabel?: string;
}

export function RecoveryStringCard({ value, onConfirmed, confirmLabel = "I saved it" }: RecoveryStringCardProps) {
  const { copied, copy } = useCopyToClipboard();
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-privacy/25 bg-privacy/5 p-4">
      <div className="flex items-start gap-2">
        <KeyRound className="mt-0.5 h-4 w-4 shrink-0 text-privacy" aria-hidden />
        <div>
          <p className="text-caption font-semibold text-foreground">Your recovery string</p>
          <p className="mt-1 text-caption leading-relaxed text-gray">
            The only way into this vault from a new device or a cleared browser. Save it in your
            password manager. It is useless to anyone without your passphrase — and useless to you
            without it too. We keep no copy and cannot reissue it.
          </p>
        </div>
      </div>

      <code className="block break-all rounded-[8px] border border-gray/15 bg-background/60 px-3 py-2.5 font-mono text-[11px] leading-relaxed text-foreground/90">
        {value}
      </code>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => {
            copy(value);
            notifyCopied("Recovery string");
          }}
          className={cn(
            "inline-flex min-h-9 items-center gap-1.5 rounded-[9px] px-3",
            "border border-gray/20 bg-muted/40 text-caption text-foreground",
            "hover:bg-muted/70 transition-colors cursor-pointer",
          )}
        >
          {copied ? <Check className="h-3.5 w-3.5 text-green-400" /> : <Copy className="h-3.5 w-3.5" />}
          {copied ? "Copied" : "Copy"}
        </button>

        {onConfirmed && (
          <button
            type="button"
            onClick={onConfirmed}
            disabled={!acknowledged}
            className={cn(
              "inline-flex min-h-9 flex-1 items-center justify-center rounded-[9px] px-4",
              "bg-foreground text-caption font-semibold text-background transition-colors cursor-pointer",
              "hover:bg-white disabled:cursor-not-allowed disabled:bg-gray/25 disabled:text-gray",
            )}
          >
            {confirmLabel}
          </button>
        )}
      </div>

      {onConfirmed && (
        <label className="flex cursor-pointer items-start gap-2 px-0.5 text-caption text-gray">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5 h-3.5 w-3.5 shrink-0 cursor-pointer accent-privacy"
          />
          {/* Storing both halves in one place quietly turns two-of-two back into
              one-of-one, and no code can prevent it. Saying so is the mitigation. */}
          I have saved this somewhere I will still have it if I lose this device — and my passphrase
          is not stored next to it.
        </label>
      )}
    </div>
  );
}
