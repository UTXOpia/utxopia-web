"use client";

import { useState, useEffect } from "react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";

interface WalletButtonProps {
  className?: string;
  /**
   * Overrides the button text. `BaseWalletMultiButton` renders children in
   * place of its label in *every* state, connected included — so only pass
   * this where the button is rendered solely while disconnected. "Select
   * Wallet" says what the widget does; on a page with one job, saying what the
   * click achieves is worth more.
   */
  label?: string;
}

/**
 * Client-side only wallet button wrapper
 * Fixes hydration mismatch by only rendering after mount
 */
export function WalletButton({ className = "", label }: WalletButtonProps) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  // The placeholder has to match the real button's size and text, or the layout
  // moves under the cursor as it hydrates.
  if (!mounted) {
    return (
      <button className={className} disabled>
        {label ?? "Select Wallet"}
      </button>
    );
  }

  return <WalletMultiButton className={className}>{label}</WalletMultiButton>;
}
