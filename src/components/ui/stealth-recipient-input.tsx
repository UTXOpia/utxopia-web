"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { LockKeyhole, UserRound, Pencil } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  encodeStealthMetaAddress,
  getConfig,
  type StealthMetaAddress,
} from "@utxopia/sdk";
import { RecipientInput } from "@/components/send/recipient-input";
import type { RecipientType } from "@/components/send/recipient-detect";
import { useRecipientResolution } from "@/hooks/use-recipient-resolution";

/**
 * Private-destination field: the same input, detection ladder and debounced
 * name lookup the send flow uses, narrowed to private recipients and wrapped
 * with the "my own vault" affordance the deposit flows need.
 */

const STEALTH_ONLY: readonly RecipientType[] = ["stealth_sns", "stealth_meta"];

interface StealthRecipientInputProps {
  onResolved: (meta: StealthMetaAddress | null, name: string | null) => void;
  error: string | null;
  onError: (error: string | null) => void;
  className?: string;
  icon?: React.ReactNode;
  /** If provided, shows a "Self" button to auto-fill with own stealth address */
  selfMeta?: StealthMetaAddress | null;
  /** Compact mode: no label, tighter padding */
  compact?: boolean;
  /** Pre-fill with the user's own private address when available. */
  defaultToSelf?: boolean;
  label?: string;
}

export function StealthRecipientInput({
  onResolved,
  error,
  onError,
  className,
  icon,
  selfMeta,
  compact = false,
  defaultToSelf = false,
  label = "Recipient",
}: StealthRecipientInputProps) {
  const [recipient, setRecipient] = useState("");
  const [showManualInput, setShowManualInput] = useState(!defaultToSelf);
  const hasDefaultedToSelf = useRef(false);

  const config = getConfig();
  const parentDomain = config.snsParentDomain || "utxopia";
  const selfEncoded = useMemo(
    () => (selfMeta ? encodeStealthMetaAddress(selfMeta) : null),
    [selfMeta],
  );

  const resolution = useRecipientResolution(recipient, {
    allow: STEALTH_ONLY,
    disallowedMessage: `Enter a .${parentDomain}.sol name or utxo: private address`,
  });
  const isValid = resolution.status === "found";

  // Parents own the resolved value but pass fresh callbacks every render, so
  // hand results up through refs rather than making them effect dependencies —
  // otherwise every parent render would re-fire the handoff.
  const callbacks = useRef({ onResolved, onError });
  useEffect(() => {
    callbacks.current = { onResolved, onError };
  });
  useEffect(() => {
    callbacks.current.onResolved(resolution.meta, resolution.name);
    callbacks.current.onError(resolution.error);
  }, [resolution.meta, resolution.name, resolution.error]);

  useEffect(() => {
    if (!defaultToSelf || !selfEncoded || recipient.trim() || hasDefaultedToSelf.current) return;
    hasDefaultedToSelf.current = true;
    setShowManualInput(false);
    setRecipient(selfEncoded);
  }, [defaultToSelf, selfEncoded, recipient]);

  if (defaultToSelf && selfEncoded && isValid && !showManualInput) {
    return (
      <div className={className}>
        <div className="rounded-[10px] border border-privacy/25 bg-privacy/8 px-3 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-privacy/10">
                <LockKeyhole className="h-4 w-4 text-privacy" />
              </div>
              <div className="min-w-0">
                <p className="text-body2-semibold text-foreground">My private vault</p>
                <p className="truncate font-mono text-[11px] text-gray/50">
                  {selfEncoded.slice(0, 12)}...{selfEncoded.slice(-8)}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowManualInput(true)}
              className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border border-gray/15 bg-muted/40 px-2.5 py-1.5 text-[11px] text-gray-light transition-colors hover:border-privacy/30 hover:text-foreground"
            >
              <Pencil className="h-3 w-3" />
              Edit
            </button>
          </div>
        </div>
      </div>
    );
  }

  const selfButton = isValid ? undefined : (
    <button
      type="button"
      disabled={!selfEncoded}
      onClick={() => {
        if (!selfEncoded) return;
        setRecipient(selfEncoded);
        setShowManualInput(false);
      }}
      className={cn(
        "absolute right-3 top-1/2 -translate-y-1/2 p-1.5 rounded-md border transition-colors",
        selfEncoded
          ? "bg-purple/10 hover:bg-purple/20 border-purple/20 cursor-pointer"
          : "bg-gray/5 border-gray/15 cursor-not-allowed opacity-40",
      )}
      title={selfEncoded ? "Use your private receive address" : "Unlock your private vault to use this address"}
    >
      <UserRound className={cn("w-3.5 h-3.5", selfEncoded ? "text-purple" : "text-gray")} />
    </button>
  );

  return (
    <RecipientInput
      className={className}
      value={recipient}
      onChange={setRecipient}
      detection={resolution.detection}
      snsStatus={resolution.status}
      error={error && !isValid ? error : null}
      label={label}
      placeholder={`alice.${parentDomain}.sol, @alice or utxo:...`}
      compact={compact}
      icon={icon}
      action={selfButton}
    />
  );
}
