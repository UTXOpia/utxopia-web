"use client";

import { createContext, useContext } from "react";
import type { PublicKey, Transaction } from "@solana/web3.js";

export type PrivySolanaAuthority = {
  enabled: boolean;
  ready: boolean;
  authenticated: boolean;
  /**
   * Whether the provider's own modal is on screen.
   *
   * Two things need it and neither is cosmetic. That modal is portalled outside
   * our dialog, so a focus trap around ours will pull focus back out of its
   * email field and the member simply cannot type. And `login()` returns before
   * anything happens, so a member who dismisses the modal without signing in
   * leaves us waiting for an event that is never coming.
   */
  isModalOpen: boolean;
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
  /**
   * Whichever identifier the member would recognise — the email or account they
   * signed in with. Only for showing them which one they are on; nothing keys
   * off it.
   */
  accountLabel: string | null;
  /**
   * The provider's stable id for this member. Salts the root passphrase, so it
   * has to be the same string on every device and outlive a linked email
   * changing — never the label above.
   */
  accountId: string | null;
  logout: () => Promise<void>;
};

export const noopPrivySolanaAuthority: PrivySolanaAuthority = {
  enabled: false,
  ready: true,
  authenticated: false,
  isModalOpen: false,
  publicKey: null,
  login: async () => {},
  ensureWallet: async () => null,
  signTransaction: async (transaction) => transaction,
  signMessage: async () => {
    throw new Error("Privy is not configured");
  },
  accountLabel: null,
  accountId: null,
  logout: async () => {},
};

export const PrivySolanaContext = createContext<PrivySolanaAuthority>(noopPrivySolanaAuthority);

export function usePrivySolanaAuthority() {
  return useContext(PrivySolanaContext);
}
