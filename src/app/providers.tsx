"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { Toaster } from "sonner";
import { StoreHydration } from "@/stores";
import { ChainThemeSync } from "@/components/chain-theme-sync";
import { getSolanaRpcUrl } from "@/lib/api/constants";
import { UiModeProvider } from "@/hooks/use-ui-mode";
import { UtxopiaPrivyProvider } from "@/lib/privy-solana";
import { DevSigner, devSolanaAdapters } from "@/lib/dev-signer";
import { ZkLoginCallbackHandler } from "@/components/sui/zklogin-callback-handler";

// Import wallet adapter CSS
import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Simplified providers - only Solana wallet adapter requires React Context.
 * All other state (Bitcoin wallet, UTXOpia keys, notes) is managed by Zustand stores.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // Helius primary (supports getProgramAccounts), fallback to configured RPC
  const endpoint = useMemo(
    () => getSolanaRpcUrl(),
    []
  );

  // Configure supported wallets
  const wallets = useMemo(() => [new PhantomWalletAdapter(), ...devSolanaAdapters()], []);

  return (
    <UtxopiaPrivyProvider>
      <ConnectionProvider endpoint={endpoint}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <UiModeProvider>
              {/* Hydrate Zustand stores (Bitcoin wallet, Poseidon) */}
              <StoreHydration />
              <DevSigner />
              {/* Complete Sui zkLogin (Google) callback + restore chain=sui on any landing page */}
              <ZkLoginCallbackHandler />
              {/* Reflect active chain onto <html data-chain> for accent tokens */}
              <ChainThemeSync />
              {children}
              <Toaster
                position="top-right"
                toastOptions={{
                  style: {
                    background: "var(--muted)",
                    border: "1px solid rgba(139, 138, 158, 0.15)",
                    color: "var(--color-gray-light)",
                  },
                  classNames: {
                    success: "!border-privacy/30 !bg-privacy/10",
                    error: "!border-error/30 !bg-error/10",
                    warning: "!border-warning-alt/30 !bg-warning-alt/10",
                  },
                }}
              />
            </UiModeProvider>
          </WalletModalProvider>
        </WalletProvider>
      </ConnectionProvider>
    </UtxopiaPrivyProvider>
  );
}
