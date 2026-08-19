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
   * Raw message signature — the unlock factor behind E_login.
   *
   * Must be byte-for-byte stable across sessions and devices: it is the salt
   * the PIN is stretched under, so a re-encoded message or a signer that adds
   * randomness means nobody can reproduce their own key. Ed25519 is
   * deterministic by RFC 8032 and Solana signs that way, which is the whole
   * assumption this rests on — pin the Privy SDK version, and treat any change
   * here the way Umbra had to treat eth_sign -> personal_sign.
   *
   * Losing it costs a wrapping, not an identity: the recovery string still
   * opens the vault. That is the point of wrapping a seed instead of deriving
   * one from a signature.
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
