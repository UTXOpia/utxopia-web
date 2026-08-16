/**
 * Vault identity — creating, unlocking and rotating the seed behind a vault.
 *
 * Thin layer over `vault-envelope`: that module knows how to wrap bytes, this
 * one knows where the wrappings live, which vault they belong to, and what
 * order things must happen in. Deliberately free of React and of the store so
 * the security-carrying paths can be tested directly.
 *
 * One seed per network+vault. Switching vaults is switching identity, which is
 * why every storage key carries both — a wrapping that leaked across that
 * boundary would hand somebody the wrong pool's notes.
 */

import {
  type VaultEnvelope,
  EnvelopeIdentityError,
  assertIdentity,
  decodeEnvelope,
  deriveFromPassphrase,
  encodeEnvelope,
  envelopeFromHex,
  envelopeToHex,
  guardFor,
  newSalt,
  newSeed,
  unwrapSeed,
  wrapSeed,
} from "@/lib/vault-envelope";

const DEVICE_ENVELOPE_PREFIX = "utxo:envelope:v1:";

/** Minimum a member may choose. Below this the string is the weaker half. */
export const MIN_PASSPHRASE_LENGTH = 12;

export class WeakPassphraseError extends Error {
  constructor() {
    super(`Use at least ${MIN_PASSPHRASE_LENGTH} characters — this is the only lock on your recovery string.`);
    this.name = "WeakPassphraseError";
  }
}

export interface VaultScope {
  networkId: string;
  vaultId: string;
}

/** Derives the stealth meta-address for a seed. Injected so this module stays testable. */
export type MetaAddressFor = (seed: Uint8Array) => Promise<string>;

function deviceKey(scope: VaultScope): string {
  return `${DEVICE_ENVELOPE_PREFIX}${scope.networkId}:${scope.vaultId}`;
}

export function readDeviceEnvelope(scope: VaultScope): VaultEnvelope | null {
  if (typeof window === "undefined") return null;
  const hex = localStorage.getItem(deviceKey(scope));
  if (!hex) return null;
  try {
    return envelopeFromHex(hex);
  } catch {
    // A corrupt local wrapping is not evidence of anything except a corrupt
    // local wrapping. Fall through to the recovery string rather than claiming
    // the member has no vault.
    return null;
  }
}

export function writeDeviceEnvelope(scope: VaultScope, envelope: VaultEnvelope): void {
  localStorage.setItem(deviceKey(scope), envelopeToHex(envelope));
}

export function clearDeviceEnvelope(scope: VaultScope): void {
  localStorage.removeItem(deviceKey(scope));
}

/** Has this browser ever held a vault for this scope? Drives "restore or create". */
export function hasDeviceEnvelope(scope: VaultScope): boolean {
  return readDeviceEnvelope(scope) !== null;
}

export function assertPassphrase(passphrase: string): void {
  if (passphrase.trim().length < MIN_PASSPHRASE_LENGTH) throw new WeakPassphraseError();
}

/** Wrap a seed under a passphrase. Every call mints a fresh salt. */
export async function buildRecoveryString(input: {
  seed: Uint8Array;
  passphrase: string;
  metaAddress: string;
}): Promise<string> {
  assertPassphrase(input.passphrase);
  const salt = newSalt();
  return encodeEnvelope(
    await wrapSeed({
      seed: input.seed,
      keyMaterial: deriveFromPassphrase(input.passphrase, salt),
      salt,
      guard: guardFor(input.metaAddress),
    }),
  );
}

/**
 * First run: a brand-new identity plus both wrappings.
 *
 * The recovery string comes back rather than being stored anywhere, because the
 * member has to put it somewhere themselves — that act is the backup, and any
 * copy we keep would only weaken it.
 */
export async function createVault(input: {
  scope: VaultScope;
  passphrase: string;
  /**
   * Omitted when this browser cannot supply key material worth wrapping under
   * (see PrfUnavailableError). The vault is still created and still has a
   * recovery string; it simply is not remembered here, which is the honest
   * outcome rather than a wrapping anyone reading the profile could open.
   */
  deviceKeyMaterial?: Uint8Array;
  metaAddressFor: MetaAddressFor;
}): Promise<{ seed: Uint8Array; metaAddress: string; recoveryString: string }> {
  assertPassphrase(input.passphrase);
  const seed = newSeed();
  const metaAddress = await input.metaAddressFor(seed);

  const recoveryString = await buildRecoveryString({ seed, passphrase: input.passphrase, metaAddress });
  if (input.deviceKeyMaterial) {
    await armDevice({
      scope: input.scope,
      seed,
      metaAddress,
      deviceKeyMaterial: input.deviceKeyMaterial,
    });
  }

  return { seed, metaAddress, recoveryString };
}

/** Add (or replace) this device's daily wrapping for a seed already in hand. */
export async function armDevice(input: {
  scope: VaultScope;
  seed: Uint8Array;
  metaAddress: string;
  deviceKeyMaterial: Uint8Array;
}): Promise<void> {
  const salt = newSalt();
  writeDeviceEnvelope(
    input.scope,
    await wrapSeed({
      seed: input.seed,
      keyMaterial: input.deviceKeyMaterial,
      salt,
      guard: guardFor(input.metaAddress),
    }),
  );
}

export class NoDeviceEnvelopeError extends Error {
  constructor() {
    super("This browser has no vault yet. Restore from your recovery string.");
    this.name = "NoDeviceEnvelopeError";
  }
}

/** Daily path. Throws rather than silently falling back to a new identity. */
export async function unlockWithDevice(input: {
  scope: VaultScope;
  deviceKeyMaterial: Uint8Array;
  metaAddressFor: MetaAddressFor;
}): Promise<{ seed: Uint8Array; metaAddress: string }> {
  const envelope = readDeviceEnvelope(input.scope);
  if (!envelope) throw new NoDeviceEnvelopeError();
  const seed = await unwrapSeed(envelope, input.deviceKeyMaterial);
  const metaAddress = await input.metaAddressFor(seed);
  assertIdentity(envelope, metaAddress);
  return { seed, metaAddress };
}

/**
 * New device. Arms this browser on success so the member types the passphrase
 * once rather than every session.
 */
export async function unlockWithRecoveryString(input: {
  scope: VaultScope;
  recoveryString: string;
  passphrase: string;
  deviceKeyMaterial?: Uint8Array;
  metaAddressFor: MetaAddressFor;
}): Promise<{ seed: Uint8Array; metaAddress: string }> {
  const envelope = decodeEnvelope(input.recoveryString);
  const seed = await unwrapSeed(
    envelope,
    deriveFromPassphrase(input.passphrase, envelope.kdf.salt, envelope.kdf),
  );
  const metaAddress = await input.metaAddressFor(seed);
  assertIdentity(envelope, metaAddress);

  if (input.deviceKeyMaterial) {
    await armDevice({ scope: input.scope, seed, metaAddress, deviceKeyMaterial: input.deviceKeyMaterial });
  }
  return { seed, metaAddress };
}

/**
 * Re-wrap under a new passphrase. Returns the new string; the caller must tell
 * the member the old one still opens the vault with the old passphrase, because
 * a string already written down cannot be revoked. Rotating the seed is the
 * only thing that actually retires it.
 */
export async function changePassphrase(input: {
  seed: Uint8Array;
  metaAddress: string;
  nextPassphrase: string;
}): Promise<string> {
  return buildRecoveryString({
    seed: input.seed,
    passphrase: input.nextPassphrase,
    metaAddress: input.metaAddress,
  });
}

/**
 * Bring an identity that predates envelopes under one, keeping the identity.
 * The seed is whatever already produced this member's notes — wrapping it does
 * not move anything, which is the point.
 */
export async function adoptExistingSeed(input: {
  scope: VaultScope;
  seed: Uint8Array;
  passphrase: string;
  deviceKeyMaterial: Uint8Array;
  metaAddressFor: MetaAddressFor;
}): Promise<{ metaAddress: string; recoveryString: string }> {
  assertPassphrase(input.passphrase);
  const metaAddress = await input.metaAddressFor(input.seed);
  const recoveryString = await buildRecoveryString({
    seed: input.seed,
    passphrase: input.passphrase,
    metaAddress,
  });
  await armDevice({
    scope: input.scope,
    seed: input.seed,
    metaAddress,
    deviceKeyMaterial: input.deviceKeyMaterial,
  });
  return { metaAddress, recoveryString };
}

export { EnvelopeIdentityError };
