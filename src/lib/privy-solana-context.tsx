"use client";

import { createContext, useContext } from "react";
import type { PublicKey, Transaction } from "@solana/web3.js";

export type PrivySolanaAuthority = {
  enabled: boolean;
  ready: boolean;
  authenticated: boolean;
  publicKey: PublicKey | null;
  login: () => Promise<void>;
  ensureWallet: () => Promise<PublicKey | null>;
  signTransaction: (transaction: Transaction) => Promise<Transaction>;
};

export const noopPrivySolanaAuthority: PrivySolanaAuthority = {
  enabled: false,
  ready: true,
  authenticated: false,
  publicKey: null,
  login: async () => {},
  ensureWallet: async () => null,
  signTransaction: async (transaction) => transaction,
};

export const PrivySolanaContext = createContext<PrivySolanaAuthority>(noopPrivySolanaAuthority);

export function usePrivySolanaAuthority() {
  return useContext(PrivySolanaContext);
}
