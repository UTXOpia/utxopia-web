"use client";

/**
 * Chain-agnostic Send / Cash-out entry points. These read the active chain from
 * the environment and render the right implementation, so pages stay free of
 * per-chain branching.
 *
 *   • Solana → SendForm (recipient-aware: BTC / wallet / stealth / claim link)
 *   • Sui    → SuiSendFlow (recipient-aware: stealth/name transfer, 0x cash out)
 */

import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter } from "@/lib/chain-registry";
import { SendForm } from "./send-form";
import { SuiSendFlow } from "./sui-send-flow";

function useIsSui() {
  const { config } = useChainEnvironment();
  return getChainAdapter(config).id === "sui";
}

/** Full send experience (private transfer, cash out, and — on Solana — claim links). */
export function SendFlow() {
  return useIsSui() ? <SuiSendFlow /> : <SendForm />;
}

/** Cash-out experience. On Sui the recipient still decides the action; the page
 *  copy frames it as a cash out. On Solana we hide the claim-link affordance. */
export function CashOutFlow() {
  return useIsSui() ? <SuiSendFlow /> : <SendForm showClaimLink={false} />;
}
