"use client";

import { useState } from "react";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { VAULT_TOKENS } from "@/lib/supported-tokens";
import type { RecipientType } from "./recipient-detect";

export interface TokenSourcePickerProps {
  recipientType: RecipientType | "claim_link" | null;
  selected: string;
  onSelect: (symbol: string) => void;
  /** Use native asset names when selecting from the private balance. */
  displayPrivateAssets?: boolean;
  /** "inline" is a compact pill meant to sit inside the amount field. */
  variant?: "field" | "inline";
  className?: string;
}

type VaultToken = (typeof VAULT_TOKENS)[number];

function allowedFor(recipientType: TokenSourcePickerProps["recipientType"]) {
  if (recipientType === "btc") {
    return VAULT_TOKENS.filter((t) => t.shieldedSymbol === "zkBTC");
  }
  // stealth_sns | stealth_meta | spl_wallet | claim_link | null → any vault token
  return VAULT_TOKENS;
}

const LOCKED_TO_BTC =
  "Bitcoin addresses can only receive BTC. To cash out another asset, use a Solana wallet.";

function label(token: VaultToken | undefined, privateAssets: boolean) {
  return (privateAssets ? token?.unit : token?.shieldedSymbol) ?? "zkBTC";
}

function logo(token: VaultToken | undefined, privateAssets: boolean) {
  return privateAssets ? token?.logo : token?.shieldedLogo;
}

export function TokenSourcePicker({
  recipientType,
  selected,
  onSelect,
  displayPrivateAssets = false,
  variant = "field",
  className,
}: TokenSourcePickerProps) {
  const [open, setOpen] = useState(false);
  const tokens = allowedFor(recipientType);
  const disabled = recipientType === "btc";
  const current = tokens.find((t) => t.shieldedSymbol === selected) ?? tokens[0];
  const inline = variant === "inline";
  const currentLogo = logo(current, displayPrivateAssets);

  const trigger = inline ? (
    // Locked to one asset: a greyed-out dropdown inside the amount field reads
    // as broken, so render the same information as a plain chip instead.
    disabled ? (
      <div
        className="flex shrink-0 items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-sm"
        title={LOCKED_TO_BTC}
      >
        {currentLogo && (
          <Image src={currentLogo} alt="" width={18} height={18} className="rounded-full" />
        )}
        <span className="font-medium">{label(current, displayPrivateAssets)}</span>
      </div>
    ) : (
      <button
        type="button"
        data-testid="token-source-trigger"
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "flex shrink-0 items-center gap-1.5 rounded-[8px] px-2 py-1.5 text-sm",
          "bg-background/60 border border-gray/15 hover:border-privacy/30 transition-colors",
        )}
      >
        {currentLogo && (
          <Image src={currentLogo} alt="" width={18} height={18} className="rounded-full" />
        )}
        <span className="font-medium">{label(current, displayPrivateAssets)}</span>
        <ChevronDown
          className={cn("w-3.5 h-3.5 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
    )
  ) : (
    <button
      type="button"
      data-testid="token-source-trigger"
      disabled={disabled}
      onClick={() => setOpen((o) => !o)}
      className={cn(
        "w-full flex items-center justify-between px-3 py-2.5 rounded-lg",
        "bg-muted/40 border border-gray/15 text-sm",
        disabled && "opacity-60 cursor-not-allowed",
        !disabled && "hover:border-privacy/30",
      )}
      title={disabled ? LOCKED_TO_BTC : undefined}
    >
      <span className="flex items-center gap-2">
        <span className="font-medium">{label(current, displayPrivateAssets)}</span>
        <span className="text-muted-foreground text-xs">
          {displayPrivateAssets ? "Private balance" : current?.name ?? "Bitcoin"}
        </span>
      </span>
      {!disabled && <ChevronDown className="w-4 h-4 text-muted-foreground" />}
    </button>
  );

  return (
    <div className={cn("relative", inline && "shrink-0", className)}>
      {!inline && <label className="block text-xs text-muted-foreground mb-1.5">From</label>}
      {trigger}

      {open && !disabled && (
        <div
          className={cn(
            "absolute z-20 mt-1 bg-background border border-gray/20 rounded-lg shadow-lg overflow-hidden",
            inline ? "right-0 w-[200px]" : "w-full",
          )}
        >
          {tokens.map((t) => (
            <button
              key={t.shieldedSymbol}
              type="button"
              data-testid={`token-source-${t.shieldedSymbol}`}
              onClick={() => {
                onSelect(t.shieldedSymbol);
                setOpen(false);
              }}
              className={cn(
                "w-full text-left px-3 py-2 flex items-center gap-2 text-sm",
                "hover:bg-muted/60",
                t.shieldedSymbol === selected && "bg-privacy/10 text-privacy",
              )}
            >
              {inline && logo(t, displayPrivateAssets) && (
                <Image
                  src={logo(t, displayPrivateAssets)!}
                  alt=""
                  width={18}
                  height={18}
                  className="rounded-full"
                />
              )}
              <span className="font-medium">{label(t, displayPrivateAssets)}</span>
              <span className="text-muted-foreground text-xs">
                {displayPrivateAssets ? "Private balance" : t.name}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
