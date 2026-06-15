"use client";

/**
 * AuditorKeyInput — secure viewing-key entry for the Method-Y auditor dashboard.
 *
 * Security contract:
 *  - Key bytes are kept in local component state ONLY.
 *  - Never written to localStorage, sessionStorage, URL params, Zustand-persist,
 *    or any cookie. Parent receives the raw Uint8Array only via onKey() callback,
 *    and must treat it with the same care.
 *  - Input type="password" prevents shoulder-surfing and browser autofill saving
 *    to a profile.
 *  - No console.log / console.error may reference the key bytes (enforced by not
 *    passing it to any logging path in this component).
 */

import { useState, useId } from "react";
import { Eye, EyeOff, AlertTriangle } from "lucide-react";
import { cn } from "@/lib/utils";

/** Validate a 64-char lowercase hex string representing 32 bytes. */
export function validateViewingKeyHex(hex: string): string | null {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (clean.length === 0) return null; // empty — not an error yet
  if (!/^[0-9a-fA-F]+$/.test(clean)) return "Must be a hex string (0-9, a-f).";
  if (clean.length !== 64) return `Must be exactly 64 hex characters (32 bytes). Got ${clean.length}.`;
  return null; // valid
}

/** Convert a validated 64-char hex string to Uint8Array (32 bytes). */
export function hexToBytes32(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

interface AuditorKeyInputProps {
  /** Called with the parsed 32-byte key whenever the input is valid, or null when cleared/invalid. */
  onKey: (key: Uint8Array | null) => void;
  disabled?: boolean;
  className?: string;
}

export function AuditorKeyInput({ onKey, disabled, className }: AuditorKeyInputProps) {
  const inputId = useId();
  const [raw, setRaw] = useState("");
  const [showKey, setShowKey] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    const val = e.target.value;
    setRaw(val);
    const trimmed = val.trim();

    if (trimmed === "") {
      setValidationError(null);
      onKey(null);
      return;
    }

    const err = validateViewingKeyHex(trimmed);
    setValidationError(err);

    if (!err) {
      onKey(hexToBytes32(trimmed));
    } else {
      onKey(null);
    }
  }

  function handleClear() {
    setRaw("");
    setValidationError(null);
    onKey(null);
  }

  const isValid = raw.trim().length > 0 && !validationError;

  return (
    <div className={cn("space-y-2", className)}>
      {/* Security notice — always visible */}
      <div className="flex items-start gap-2 px-3 py-2.5 rounded-[8px] bg-warning/8 border border-warning/20">
        <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
        <p className="text-[11px] text-warning/90 leading-snug">
          Your viewing key stays in this browser tab and is{" "}
          <strong className="font-semibold">never sent anywhere</strong>. It is
          not stored in localStorage, cookies, or any persistent store.
        </p>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor={inputId}
          className="text-[11px] uppercase tracking-[0.16em] text-gray-light font-semibold"
        >
          Auditor viewing private key
          <span className="ml-1.5 text-[10px] normal-case tracking-normal text-gray font-normal">
            (32-byte Ed25519, hex)
          </span>
        </label>

        <div className="relative flex items-center">
          <input
            id={inputId}
            type={showKey ? "text" : "password"}
            value={raw}
            onChange={handleChange}
            disabled={disabled}
            autoComplete="off"
            autoCorrect="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="64 hex characters (0–9, a–f)"
            aria-describedby={validationError ? `${inputId}-error` : undefined}
            aria-invalid={validationError ? true : undefined}
            className={cn(
              "w-full pr-20 pl-3 py-2.5 rounded-[10px] border bg-muted/40",
              "text-[12px] font-mono outline-none transition-colors",
              "placeholder:text-gray/40",
              validationError
                ? "border-error/50 focus:border-error/70"
                : isValid
                  ? "border-privacy/40 focus:border-privacy/60"
                  : "border-gray/15 focus:border-gray/30",
              disabled && "opacity-50 cursor-not-allowed",
            )}
          />

          <div className="absolute right-1 flex items-center gap-0.5">
            {raw && (
              <button
                type="button"
                onClick={handleClear}
                disabled={disabled}
                aria-label="Clear viewing key"
                className={cn(
                  "px-2 py-1 text-[10px] font-medium rounded-md transition-colors",
                  "text-gray hover:text-foreground",
                  disabled && "opacity-50 cursor-not-allowed",
                )}
              >
                Clear
              </button>
            )}
            <button
              type="button"
              onClick={() => setShowKey((v) => !v)}
              disabled={disabled}
              aria-label={showKey ? "Hide key" : "Show key"}
              aria-pressed={showKey}
              className={cn(
                "p-1.5 rounded-[6px] transition-colors text-gray hover:text-foreground",
                disabled && "opacity-50 cursor-not-allowed",
              )}
            >
              {showKey ? (
                <EyeOff className="w-3.5 h-3.5" aria-hidden="true" />
              ) : (
                <Eye className="w-3.5 h-3.5" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {validationError && (
          <p
            id={`${inputId}-error`}
            role="alert"
            className="text-[11px] text-error font-mono mt-1"
          >
            {validationError}
          </p>
        )}

        {isValid && (
          <p className="text-xs text-success mt-1">
            Key accepted (32 bytes).
          </p>
        )}
      </div>
    </div>
  );
}
