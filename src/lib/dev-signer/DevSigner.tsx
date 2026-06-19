"use client";
import { useEffect } from "react";
import { detectNetwork } from "@/lib/network-config";
import { isDevSignerEnabled, assertDevSignerSafe } from "./enabled";
import { loadDevKeys } from "./keys";
import { installUnisatShim } from "./btc-unisat";
import { installSuiWalletShim } from "./sui-wallet";
import { loginDevIdentity } from "./identity";
import { saveSuiAuthState } from "@/lib/sui/client";

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
    const suiAddress = installSuiWalletShim(keys.suiSecretKey, network);
    // Mark the Sui session as wallet-connected so wallet-gated flows (Coin<T>
    // shield, which requires suiAuth.method === "wallet") are reachable headlessly.
    if (network.includes("sui")) {
      saveSuiAuthState({ method: "wallet", address: suiAddress });
    }
    void loginDevIdentity(keys.utxopiaSeedHex);
  }, []);
  return null;
}
