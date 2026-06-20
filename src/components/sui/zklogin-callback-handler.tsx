"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { networkForChain } from "@/lib/chain-registry";
import { detectNetwork, hrefWithChain } from "@/lib/network-config";
import {
  consumeSuiZkLoginCallback,
  getSuiZkLoginSession,
  suiNetworkFromZkLoginState,
} from "@/lib/sui/client";

/**
 * Global Sui zkLogin callback handler. Google returns to the configured
 * `redirect_uri` (e.g. /sui or /settings) with the id_token + echoed `state` in
 * the URL fragment. This runs on every page so the callback is handled no matter
 * which page Google lands on: it consumes the id_token (derives + saves the Sui
 * wallet) and routes into the Sui chain, instead of the page defaulting to sol.
 */
export function ZkLoginCallbackHandler() {
  const router = useRouter();
  const handled = useRef(false);

  useEffect(() => {
    if (handled.current) return;
    if (typeof window === "undefined") return;
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
    if (!hash.get("id_token") && !hash.get("error")) return;
    handled.current = true;

    // Restore the sui network from `state` (preferred) or the saved session.
    const fromState = suiNetworkFromZkLoginState(hash.get("state"));
    const fromSession = getSuiZkLoginSession()?.network ?? null;
    const suiNetwork = networkForChain(
      fromState ?? fromSession ?? detectNetwork(),
      "sui",
    );

    void consumeSuiZkLoginCallback().finally(() => {
      router.replace(hrefWithChain("/vault", suiNetwork));
    });
  }, [router]);

  return null;
}
