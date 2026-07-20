"use client";

import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import {
  PrivySolanaContext,
  noopPrivySolanaAuthority,
  usePrivySolanaAuthority,
} from "@/lib/privy-solana-context";

const EnabledPrivySolanaProvider = dynamic(
  () => import("@/lib/privy-solana-enabled").then((module) => module.EnabledPrivySolanaProvider),
  { ssr: false },
);

export function UtxopiaPrivyProvider({ children }: { children: ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const clientId = process.env.NEXT_PUBLIC_PRIVY_CLIENT_ID;

  if (!appId) {
    return (
      <PrivySolanaContext.Provider value={noopPrivySolanaAuthority}>
        {children}
      </PrivySolanaContext.Provider>
    );
  }

  return (
    <EnabledPrivySolanaProvider appId={appId} clientId={clientId}>
      {children}
    </EnabledPrivySolanaProvider>
  );
}

export { usePrivySolanaAuthority };
