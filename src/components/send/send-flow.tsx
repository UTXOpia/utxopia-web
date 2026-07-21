"use client";

/**
 * Send / Cash-out entry points. Solana-only.
 *
 *   • SendForm — recipient-aware: BTC / wallet / stealth / claim link
 */

import { SendForm } from "./send-form";

/** Full send experience (private transfer, cash out, and claim links). */
export function SendFlow() {
  return <SendForm />;
}

/** Cash-out experience — same form with the claim-link affordance hidden. */
export function CashOutFlow() {
  return <SendForm mode="cashout" />;
}
