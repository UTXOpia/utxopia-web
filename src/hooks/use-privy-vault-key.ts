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
import {
  ROOT_KDF,
  assertPin,
  buildRootMessage,
  buildUnlockMessage,
  deriveFromPassphrase,
  deriveFromPin,
  rootFromSignature,
  rootSaltFor,
  unlockCommit,
} from "@/lib/vault-envelope";
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
  const { enabled, authenticated, accountId, login, ensureWallet, signMessage } =
    usePrivySolanaAuthority();
  const { networkId, vaultId } = useChainEnvironment();

  const keyMaterialFor = useCallback(
    async (pin: string): Promise<{ keyMaterial: Uint8Array; signer: string }> => {
      // Ahead of the signature prompt: making somebody approve a signature and
      // then telling them their PIN was too short is a wasted ceremony.
      assertPin(pin);

      // ensureWallet opens the login window and returns null when nobody is
      // signed in, which is fine for a button and wrong in the middle of a
      // ceremony: the call that triggered it has already failed by the time the
      // member finishes logging in, so their first attempt always errors. Sign
      // in is its own step; this one refuses rather than starting it.
      if (!authenticated) throw new LoginRequiredError();
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
    [authenticated, ensureWallet, networkId, signMessage, vaultId],
  );

  /**
   * Rebuild the root from the login and a passphrase, with nothing stored.
   *
   * The provider's account id salts the passphrase, the commit goes into a
   * frozen message, and the signature over it becomes the root — so the same
   * two inputs reproduce the same vault on a device that has never seen it.
   *
   * There is no ciphertext here and therefore no AEAD tag, which means a
   * mistyped passphrase does not fail: it rebuilds a different, empty vault in
   * silence. The caller has to show the member what came back before writing
   * anything over what is already on this device.
   */
  const deriveRoot = useCallback(
    async (passphrase: string): Promise<Uint8Array> => {
      if (!authenticated) throw new LoginRequiredError();
      const pubkey = await ensureWallet();
      if (!pubkey) throw new LoginRequiredError();
      if (!accountId) throw new LoginRequiredError();

      const secret = deriveFromPassphrase(passphrase.trim(), rootSaltFor(accountId), ROOT_KDF);
      const message = buildRootMessage(networkId, unlockCommit(secret));
      const signature = await signMessage(new TextEncoder().encode(message));
      return rootFromSignature(signature);
    },
    [accountId, authenticated, ensureWallet, networkId, signMessage],
  );

  /** Only after the wrapping it describes has actually been written. */
  const remember = useCallback(
    (signer: string) => writeDeviceSigner({ networkId, vaultId }, signer),
    [networkId, vaultId],
  );

  return { available: enabled, authenticated, login, keyMaterialFor, deriveRoot, remember };
}
