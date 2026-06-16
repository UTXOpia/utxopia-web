"use client";
import { useEffect } from "react";
import { detectNetwork } from "@/lib/network-config";
import { isDevSignerEnabled, assertDevSignerSafe } from "./enabled";
import { loadDevKeys } from "./keys";
import { installUnisatShim } from "./btc-unisat";
import { installSuiWalletShim } from "./sui-wallet";
import { loginDevIdentity } from "./identity";

export function DevSigner() {
  useEffect(() => {
    if (!isDevSignerEnabled()) return;
    const network = detectNetwork();
    assertDevSignerSafe(network); // throws on mainnet
    const keys = loadDevKeys();
    if (!keys) {
      console.error("[dev-signer] enabled but no keys (window.__UTXOPIA_DEV_KEYS or NEXT_PUBLIC_DEV_*)");
      return;
    }
    console.warn(
      "%c[dev-signer] ACTIVE — throwaway test keys, network=" + network,
      "color:#fff;background:#b30;padding:2px 6px",
    );
    installUnisatShim(keys.btcWif, network);
    installSuiWalletShim(keys.suiSecretKey, network);
    void loginDevIdentity(keys.utxopiaSeedHex);
  }, []);
  return null;
}
