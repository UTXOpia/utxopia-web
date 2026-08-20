"use client";

import React, { useMemo } from "react";
import { ConnectionProvider, WalletProvider } from "@solana/wallet-adapter-react";
import { WalletModalProvider } from "@solana/wallet-adapter-react-ui";
import { PhantomWalletAdapter } from "@solana/wallet-adapter-phantom";
import { Toaster } from "sonner";
import { StoreHydration } from "@/stores";
import { ChainThemeSync } from "@/components/chain-theme-sync";
import { getSolanaRpcUrl, getSolanaWsUrl } from "@/lib/api/constants";
import { UiModeProvider } from "@/hooks/use-ui-mode";
import { UtxopiaPrivyProvider } from "@/lib/privy-solana";
import { DevSigner, devSolanaAdapters } from "@/lib/dev-signer";
import { FeedbackWidget } from "@/components/feedback/feedback-widget";

// Import wallet adapter CSS
import "@solana/wallet-adapter-react-ui/styles.css";

/**
 * Simplified providers - only Solana wallet adapter requires React Context.
 * All other state (Bitcoin wallet, UTXOpia keys, notes) is managed by Zustand stores.
 */
export function Providers({ children }: { children: React.ReactNode }) {
  // Same-origin proxy in the browser; the keyed URL never leaves the server.
  const endpoint = useMemo(() => getSolanaRpcUrl(), []);
  // Connection would otherwise derive its websocket from `endpoint`, i.e.
  // wss://<origin>/api/rpc — a path that serves no websocket, which makes every
  // confirmation wait time out instead of failing.
  const wsEndpoint = useMemo(() => getSolanaWsUrl(), []);

  // Configure supported wallets
  const wallets = useMemo(() => [new PhantomWalletAdapter(), ...devSolanaAdapters()], []);

  return (
    <UtxopiaPrivyProvider>
      <ConnectionProvider endpoint={endpoint} config={{ commitment: "confirmed", wsEndpoint }}>
        <WalletProvider wallets={wallets} autoConnect>
          <WalletModalProvider>
            <UiModeProvider>
              {/* Hydrate Zustand stores (Bitcoin wallet, Poseidon) */}
              <StoreHydration />
              <DevSigner />
              {/* Reflect active chain onto <html data-chain> for accent tokens */}
              <ChainThemeSync />
              {children}
              <FeedbackWidget />
              <Toaster
                position="top-right"
                // On a phone sonner spans the full width at the top, which put
                // every toast straight across the header of whatever dialog was
                // open — "Recovery string copied" sitting on top of the title
                // telling somebody what they were looking at. Desktop has room
                // beside the content and keeps its corner; mobile drops below
                // the browser chrome and the first line of a centred dialog.
                mobileOffset={{ top: "5.5rem", left: "0.75rem", right: "0.75rem" }}
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
