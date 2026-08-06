"use client";
import { useEffect } from "react";
import { detectNetwork } from "@/lib/network-config";
import { isDevSignerEnabled, assertDevSignerSafe } from "./enabled";
import { loadDevKeys } from "./keys";
import { installUnisatShim } from "./btc-unisat";
import { loginDevIdentity } from "./identity";

/** How long to keep looking for injected keys before giving up. */
const KEY_WAIT_MS = 5_000;
const KEY_POLL_MS = 100;

export function DevSigner() {
  useEffect(() => {
    if (!isDevSignerEnabled()) return;
    const network = detectNetwork();
    assertDevSignerSafe(network); // throws on mainnet

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    // Keys can land after mount: a driver that sets window.__UTXOPIA_DEV_KEYS
    // from an init script races React hydration. Reading once and returning
    // meant the signer stayed off for the rest of the page's life, and the
    // miss was logged as an error even though it is the normal first tick.
    const deadline = Date.now() + KEY_WAIT_MS;
    const attempt = () => {
      if (cancelled) return;
      const keys = loadDevKeys();
      if (!keys) {
        if (Date.now() >= deadline) {
          console.warn(
            "[dev-signer] enabled but no keys after " +
              `${KEY_WAIT_MS}ms (window.__UTXOPIA_DEV_KEYS or NEXT_PUBLIC_DEV_*)`,
          );
          return;
        }
        timer = setTimeout(attempt, KEY_POLL_MS);
        return;
      }
      console.warn(
        "%c[dev-signer] ACTIVE — throwaway test keys, network=" + network,
        "color:#fff;background:#b30;padding:2px 6px",
      );
      installUnisatShim(keys.btcWif, network);
      void loginDevIdentity(keys.utxopiaSeedHex);
    };
    attempt();

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, []);
  return null;
}
