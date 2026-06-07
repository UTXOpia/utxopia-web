"use client";

import { useEffect } from "react";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter } from "@/lib/chain-registry";

/**
 * Reflects the active chain onto <html data-chain> so chain-context accent
 * tokens (--chain, --ring) resolve to the network's color. Renders nothing.
 */
export function ChainThemeSync() {
  const { config } = useChainEnvironment();
  const chain = getChainAdapter(config).id;

  useEffect(() => {
    document.documentElement.dataset.chain = chain;
  }, [chain]);

  return null;
}
