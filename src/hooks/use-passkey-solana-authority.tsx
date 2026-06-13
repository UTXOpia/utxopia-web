"use client";

import { useMemo } from "react";
import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

export interface PasskeySolanaAuthority {
  enabled: boolean;
  publicKey: PublicKey | null;
  signTransaction: (tx: Transaction) => Promise<Transaction>;
}

/** Surfaces the in-memory passkey-derived name-owner key as a Solana signer,
 *  so passkey users can own + sign their .utxopia.sol name. No funds live here. */
export function usePasskeySolanaAuthority(): PasskeySolanaAuthority {
  const secret = useUTXOpiaStore((s) => s.passkeyNameOwnerSecret);

  return useMemo(() => {
    if (!secret) {
      return {
        enabled: false,
        publicKey: null,
        signTransaction: async () => {
          throw new Error("No passkey name-owner key in memory");
        },
      };
    }
    const kp = Keypair.fromSecretKey(secret);
    return {
      enabled: true,
      publicKey: kp.publicKey,
      signTransaction: async (tx: Transaction) => {
        tx.partialSign(kp);
        return tx;
      },
    };
  }, [secret]);
}
