"use client";

import { Check, X, Loader2, Clipboard } from "lucide-react";
import { useCallback, useId } from "react";
import { cn } from "@/lib/utils";
import { detectRecipient, type DetectionResult } from "./recipient-detect";

/**
 * Name resolution state, fed in from the parent form so the input can
 * surface "Resolving…" / not-found / valid messaging
 * without owning the lookup itself.
 */
export type SnsStatus = "idle" | "resolving" | "found" | "not_found";

export interface RecipientInputProps {
  value: string;
  onChange: (next: string) => void;
  /** Optional parent-owned detection, used when a flow constrains recipient types. */
  detection?: DetectionResult;
  label?: string;
  placeholder?: string;
  /** Name resolve state from the parent (only meaningful for stealth_sns). */
  snsStatus?: SnsStatus;
  /** Parent-owned error text; wins over the derived status line. */
  error?: string | null;
  className?: string;
  readOnly?: boolean;
  /** Tighter padding, no label — for inline rows. */
  compact?: boolean;
  /** Rendered inside the field, on the left. */
  icon?: React.ReactNode;
  /** Replaces the clipboard button on the right (e.g. a "use my own address" action). */
  action?: React.ReactNode;
}

function statusFor(
  value: string,
  snsStatus: SnsStatus,
  detectionOverride?: DetectionResult,
): {
  detection: DetectionResult;
  tone: "neutral" | "ok" | "warn" | "bad";
  label: string;
} {
  const detection = detectionOverride ?? detectRecipient(value);
  // Name-specific states override the generic detection feedback, since
  // syntactically-valid names can still point to nothing.
  if (detection.type === "stealth_sns") {
    const label = ".utxopia.sol";
    if (snsStatus === "resolving") {
      return { detection, tone: "warn", label: `Looking up ${label} record...` };
    }
    if (snsStatus === "not_found") {
      return {
        detection,
        tone: "bad",
        label: `Cannot find this ${label} record`,
      };
    }
    if (snsStatus === "found") {
      return { detection, tone: "ok", label: "Resolved" };
    }
  }
  if (detection.type === "empty") {
    return { detection, tone: "neutral", label: "" };
  }
  if (detection.type === "invalid") {
    return {
      detection,
      tone: "bad",
      label: detection.reason ?? "Not a valid recipient",
    };
  }
  if (detection.type === "ambiguous") {
    return {
      detection,
      tone: "warn",
      label: "Ambiguous — try a longer or clearer address",
    };
  }
  return { detection, tone: "ok", label: detection.reason ?? "Looks valid" };
}

export function RecipientInput({
  value,
  onChange,
  detection,
  label = "Recipient",
  placeholder = "Paste an address, @handle, or name.utxopia.sol",
  snsStatus = "idle",
  error = null,
  className,
  readOnly = false,
  compact = false,
  icon,
  action,
}: RecipientInputProps) {
  const inputId = useId();
  const derived = statusFor(value, snsStatus, detection);
  const tone = error ? "bad" : derived.tone;
  const statusLabel = error ?? derived.label;

  const onPasteFromClipboard = useCallback(async () => {
    try {
      const text = await navigator.clipboard.readText();
      onChange(text.trim());
    } catch {
      // ignore — clipboard permission denied
    }
  }, [onChange]);

  return (
    <div className={cn("space-y-1.5", className)}>
      {!compact && (
        <label htmlFor={inputId} className="block text-xs text-muted-foreground">
          {label}
        </label>
      )}
      <div className="relative">
        {icon && (
          <div className={cn("absolute top-1/2 -translate-y-1/2", compact ? "left-3" : "left-4")}>
            {icon}
          </div>
        )}
        <input
          id={inputId}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          readOnly={readOnly}
          placeholder={placeholder}
          className={cn(
            "w-full rounded-lg pr-10",
            compact ? "py-2.5" : "py-3",
            icon ? (compact ? "pl-9" : "pl-10") : "px-3",
            "bg-muted/40 border text-sm font-mono",
            "focus:outline-none focus:ring-2 focus:ring-privacy/40",
            readOnly && "cursor-default bg-muted/60 pr-3 text-muted-foreground",
            tone === "bad" && "border-red-500/40",
            tone === "ok" && "border-privacy/30",
            tone === "warn" && "border-yellow-500/30",
            tone === "neutral" && "border-gray/15",
          )}
          autoComplete="off"
          spellCheck={false}
        />
        {!readOnly &&
          (action ?? (
            <button
              type="button"
              onClick={onPasteFromClipboard}
              aria-label="Paste from clipboard"
              className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded hover:bg-muted/60 text-muted-foreground"
            >
              <Clipboard className="w-4 h-4" />
            </button>
          ))}
      </div>
      {statusLabel && (
        <div
          className={cn(
            "flex items-center gap-1.5 text-xs",
            tone === "ok" && "text-privacy",
            tone === "warn" && "text-yellow-500",
            tone === "bad" && "text-red-500",
          )}
        >
          {tone === "ok" && <Check className="w-3 h-3" />}
          {tone === "warn" && <Loader2 className="w-3 h-3 animate-spin" />}
          {tone === "bad" && <X className="w-3 h-3" />}
          <span className="break-all">{statusLabel}</span>
        </div>
      )}
    </div>
  );
}
