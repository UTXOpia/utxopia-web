"use client";

/**
 * E_login: the wrapping a browser gets when passkey PRF is not available.
 *
 * The login provider's only job here is to sign one fixed message. Nothing
 * about the vault is derived from the account, and nothing about the account
 * reaches the vault — the signature is a salt, the PIN is the secret, and the
 * seed underneath is the same random root every other wrapping holds.
 *
 * See `buildUnlockMessage` for why the message carries no member-specific
 * bytes, and the header of `vault-envelope` for what this trade costs.
 */

import { useCallback, useEffect, useState } from "react";
import { useChainEnvironment } from "@/lib/chain-environment";
import { usePrivySolanaAuthority } from "@/lib/privy-solana-context";
import { assertPin, buildUnlockMessage, deriveFromPin } from "@/lib/vault-envelope";
import { assertDeviceSigner, readDeviceSigner, writeDeviceSigner } from "@/lib/vault-identity";

export class LoginRequiredError extends Error {
  constructor() {
    super("Sign in first, then unlock with your PIN.");
    this.name = "LoginRequiredError";
  }
}

/** Did this browser arm itself under a login rather than a passkey? */
export function useLoginArmed(): boolean {
  const { networkId, vaultId } = useChainEnvironment();
  const [armed, setArmed] = useState(false);

  // localStorage is not readable during render on the server.
  useEffect(() => {
    setArmed(readDeviceSigner({ networkId, vaultId }) !== null);
  }, [networkId, vaultId]);

  return armed;
}

export function usePrivyVaultKey() {
  const { enabled, ensureWallet, signMessage } = usePrivySolanaAuthority();
  const { networkId, vaultId } = useChainEnvironment();

  const keyMaterialFor = useCallback(
    async (pin: string): Promise<{ keyMaterial: Uint8Array; signer: string }> => {
      // Ahead of the signature prompt: making somebody approve a signature and
      // then telling them their PIN was too short is a wasted ceremony.
      assertPin(pin);

      const pubkey = await ensureWallet();
      if (!pubkey) throw new LoginRequiredError();
      const signer = pubkey.toBase58();

      // Before signing, so a provider that hands back a different embedded
      // wallet fails naming that, rather than as a PIN that no longer works.
      assertDeviceSigner({ networkId, vaultId }, signer);

      const signature = await signMessage(
        new TextEncoder().encode(buildUnlockMessage(networkId)),
      );
      return { keyMaterial: deriveFromPin(pin, signature), signer };
    },
    [ensureWallet, networkId, signMessage, vaultId],
  );

  /** Only after the wrapping it describes has actually been written. */
  const remember = useCallback(
    (signer: string) => writeDeviceSigner({ networkId, vaultId }, signer),
    [networkId, vaultId],
  );

  return { available: enabled, keyMaterialFor, remember };
}
