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
  /**
   * Raw message signature — the unlock factor for the vault envelope.
   *
   * Must be byte-for-byte stable across sessions and devices: it is HKDF'd into
   * the key that opens the envelope, so a wrapped or re-encoded message means
   * nobody can open theirs. Pin the Privy SDK version, and treat any change
   * here the way Umbra had to treat eth_sign → personal_sign.
   */
  signMessage: (message: Uint8Array) => Promise<Uint8Array>;
};

export const noopPrivySolanaAuthority: PrivySolanaAuthority = {
  enabled: false,
  ready: true,
  authenticated: false,
  publicKey: null,
  login: async () => {},
  ensureWallet: async () => null,
  signTransaction: async (transaction) => transaction,
  signMessage: async () => {
    throw new Error("Privy is not configured");
  },
};

export const PrivySolanaContext = createContext<PrivySolanaAuthority>(noopPrivySolanaAuthority);

export function usePrivySolanaAuthority() {
  return useContext(PrivySolanaContext);
}
