"use client";

/**
 * The second factor for E_login. Six digits is deliberately weak on its own —
 * the signature beside it carries the entropy — so this field has none of the
 * strength machinery `PassphraseField` needs, and must never be offered as a
 * way into a recovery string.
 */

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { cn } from "@/lib/utils";
import { MIN_PIN_LENGTH } from "@/lib/vault-envelope";

export function PinField({
  value,
  onChange,
  disabled,
  autoFocus,
  label = "PIN",
  hint,
}: {
  value: string;
  onChange: (next: string) => void;
  disabled?: boolean;
  autoFocus?: boolean;
  label?: string;
  hint?: string;
}) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor="vault-pin" className="px-1 text-[11px] font-medium uppercase tracking-wider text-gray/50">
        {label}
      </label>
      <div className="relative">
        <input
          id="vault-pin"
          type={visible ? "text" : "password"}
          inputMode="numeric"
          value={value}
          autoFocus={autoFocus}
          disabled={disabled}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => onChange(e.target.value)}
          className={cn(
            "w-full rounded-[10px] border border-gray/20 bg-muted/40 px-3 py-2.5 pr-10",
            "font-mono text-body2 text-foreground placeholder:text-gray/35",
            "focus:border-privacy/50 focus:outline-none focus:ring-1 focus:ring-privacy/30",
            "disabled:opacity-50",
          )}
          placeholder={`at least ${MIN_PIN_LENGTH} digits`}
        />
        <button
          type="button"
          onClick={() => setVisible((v) => !v)}
          aria-label={visible ? "Hide PIN" : "Show PIN"}
          className="absolute right-2 top-1/2 -translate-y-1/2 cursor-pointer rounded p-1.5 text-gray/40 transition-colors hover:text-foreground"
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {hint && <p className="px-1 text-[11px] leading-relaxed text-gray/45">{hint}</p>}
    </div>
  );
}
