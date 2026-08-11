"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { RecipientInput } from "@/components/send/recipient-input";
import {
  detectRecipientAllowing,
  type RecipientType,
} from "@/components/send/recipient-detect";
import { KnownDestinationCard } from "@/components/ui/known-destination-card";

/**
 * The one field for entering a Solana wallet address. Owns base58 validation,
 * and — where it makes sense — offers the connected wallet instead of an empty
 * box, with one tap back to it after an edit.
 */

const SPL_ONLY: readonly RecipientType[] = ["spl_wallet"];

export interface SolanaAddressFieldProps {
  value: string;
  onChange: (next: string) => void;
  label?: string;
  placeholder?: string;
  /** Help or warning text under the field. */
  help?: React.ReactNode;
  /**
   * Offer the connected wallet as the value. Off for flows where accepting an
   * address has consequences the user must read first.
   */
  useConnectedWallet?: boolean;
  /** Title on the collapsed card. */
  connectedTitle?: string;
  disabled?: boolean;
  className?: string;
}

export function SolanaAddressField({
  value,
  onChange,
  label = "Solana wallet address",
  placeholder = "Paste a Solana wallet address",
  help,
  useConnectedWallet = true,
  connectedTitle = "My connected wallet",
  disabled = false,
  className,
}: SolanaAddressFieldProps) {
  const { publicKey } = useWallet();
  const connected = useConnectedWallet ? publicKey?.toBase58() ?? null : null;
  const [editing, setEditing] = useState(false);

  // Callers pass a fresh onChange every render; keep it out of the effect deps
  // so connecting a wallet fills once instead of on every parent render.
  const change = useRef(onChange);
  useEffect(() => {
    change.current = onChange;
  });
  useEffect(() => {
    if (!connected) return;
    change.current(connected);
    setEditing(false);
  }, [connected]);

  const detection = useMemo(
    () => detectRecipientAllowing(value, SPL_ONLY, "Enter a valid Solana wallet address"),
    [value],
  );

  if (connected && value === connected && !editing) {
    return (
      <div className={cn("space-y-1.5", className)}>
        <span className="block text-xs text-muted-foreground">{label}</span>
        <KnownDestinationCard
          icon={<Wallet className="h-4 w-4 text-privacy" />}
          title={connectedTitle}
          value={connected}
          onEdit={() => setEditing(true)}
          editTestId="edit-destination"
        />
        {help && <div className="text-xs text-muted-foreground">{help}</div>}
      </div>
    );
  }

  return (
    <div className={cn("space-y-1.5", className)}>
      <RecipientInput
        value={value}
        onChange={onChange}
        detection={detection}
        label={label}
        placeholder={placeholder}
        readOnly={disabled}
        action={
          connected ? (
            <button
              type="button"
              onClick={() => {
                onChange(connected);
                setEditing(false);
              }}
              title="Use my connected wallet"
              aria-label="Use my connected wallet"
              data-testid="use-connected-wallet"
              className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md border border-purple/20 bg-purple/10 p-1.5 transition-colors hover:bg-purple/20"
            >
              <Wallet className="h-3.5 w-3.5 text-purple" />
            </button>
          ) : undefined
        }
      />
      {help && <div className="text-xs text-muted-foreground">{help}</div>}
    </div>
  );
}
