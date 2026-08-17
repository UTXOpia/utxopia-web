"use client";

import { useState, useEffect, useMemo, useRef } from "react";
import { LockKeyhole, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  encodeStealthMetaAddress,
  getConfig,
  type StealthMetaAddress,
} from "@utxopia/sdk";
import { RecipientInput } from "@/components/send/recipient-input";
import { KnownDestinationCard } from "@/components/ui/known-destination-card";
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
      <KnownDestinationCard
        className={className}
        icon={<LockKeyhole className="h-4 w-4 text-privacy" />}
        title="My private vault"
        value={selfEncoded}
        onEdit={() => setShowManualInput(true)}
        editTestId="edit-destination"
      />
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
      resolvedAddress={resolution.address}
      error={error && !isValid ? error : null}
      label={label}
      placeholder={`alice.${parentDomain}.sol, @alice or utxo:...`}
      compact={compact}
      icon={icon}
      action={selfButton}
    />
  );
}
