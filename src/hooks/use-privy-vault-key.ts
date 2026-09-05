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
import { assertDeviceSigner, dropDeviceEnvelope, readDeviceSigner, writeDeviceSigner } from "@/lib/vault-identity";

/**
 * The member closed the provider's prompt. Not an error about the vault, and
 * the provider's own wording ("The user rejected the request") reads on this
 * screen as if the member was the one rejected — beside a PIN field, which is
 * the factor that was never asked about.
 */
export class SignatureDeclinedError extends Error {
  constructor() {
    super("You closed the signature prompt. Tap unlock to try again.");
    this.name = "SignatureDeclinedError";
  }
}

/** Every provider words this differently; none of them word it for a member. */
function declined(caught: unknown): boolean {
  const code = (caught as { code?: unknown })?.code;
  if (code === 4001 || code === "ACTION_REJECTED") return true;
  const message = caught instanceof Error ? caught.message : String(caught ?? "");
  return /reject|denied|declin|cancel|dismiss|closed/i.test(message);
}

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
    const scope = { networkId, vaultId };
    const isArmed = readDeviceSigner(scope) !== null;
    // A login-armed browser keeps no wrapping; one left here predates that
    // rule and is the uncounted copy. Next reload lands on the setup screen,
    // where the recovery string publishes a counted one.
    if (isArmed) dropDeviceEnvelope(scope);
    setArmed(isArmed);
  }, [networkId, vaultId]);

  return armed;
}

export function usePrivyVaultKey() {
  const { enabled, ready, authenticated, accountId, login, ensureWallet, signMessage } =
    usePrivySolanaAuthority();
  const { networkId, vaultId } = useChainEnvironment();

  const keyMaterialFor = useCallback(
    async (
      pin: string,
      /** The wrapping's salt, which the message is bound to. New wrapping,
       *  new salt, new key — see buildUnlockMessage. */
      salt: Uint8Array,
    ): Promise<{ keyMaterial: Uint8Array; signer: string; signature: Uint8Array }> => {
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

      // Mapped here rather than at either call site: both the setup flow and
      // the unlock screen surface `caught.message` verbatim, so a provider
      // string left unmapped reaches the member on whichever one they are on.
      const signature = await signMessage(
        new TextEncoder().encode(buildUnlockMessage(networkId, salt)),
      ).catch((caught) => {
        if (declined(caught)) throw new SignatureDeclinedError();
        throw caught;
      });
      return { keyMaterial: deriveFromPin(pin, signature), signer, signature };
    },
    [authenticated, ensureWallet, networkId, signMessage, vaultId],
  );

  /** Only after the wrapping it describes has actually been written. */
  const remember = useCallback(
    (signer: string) => writeDeviceSigner({ networkId, vaultId }, signer),
    [networkId, vaultId],
  );

  return { available: enabled, ready, authenticated, accountId, login, keyMaterialFor, remember };
}
