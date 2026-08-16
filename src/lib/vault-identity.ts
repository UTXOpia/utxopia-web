/**
 * Vault identity — creating, unlocking and rotating the seed behind a vault.
 *
 * Thin layer over `vault-envelope`: that module knows how to wrap bytes, this
 * one knows where the wrappings live, which vault they belong to, and what
 * order things must happen in. Deliberately free of React and of the store so
 * the security-carrying paths can be tested directly.
 *
 * The member keeps one root seed; each pool derives its own working identity
 * from it (see `workingSeedFor`). One recovery string therefore covers
 * everything they own, while Open and Verified still hold unlinkable addresses.
 *
 * Scope binding is not optional and not in one place: it goes into the working
 * seed, into the HKDF info, and into the AEAD's additional data. An earlier
 * version bound it only through the localStorage key name, which meant a
 * genuine Open string restored cleanly into the Verified scope and overwrote
 * that vault's wrapping — the exact failure the storage layout looked like it
 * was preventing.
 */

import {
  type VaultEnvelope,
  EnvelopeIdentityError,
  EnvelopeUnlockError,
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

/**
 * FROZEN. Scope binding, in three places at once:
 *
 *   - HKDF info for the wrapping key, so one pool's wrapping cannot produce
 *     another's key
 *   - AES-GCM additionalData, so a cross-scope envelope fails the tag rather
 *     than decrypting
 *   - the working-seed derivation, so the guard has something scope-specific to
 *     compare against instead of reproducing itself
 *
 * Any one of the three alone leaves a hole. The pattern mirrors the passkey
 * path's `chainScopedPasskeySeed`, which has always domain-separated this way.
 */
export function scopeTag(scope: VaultScope): Uint8Array {
  return new TextEncoder().encode(`utxopia:vault-scope:v1:${scope.networkId}:${scope.vaultId}`);
}

/**
 * The identity actually used on chain for a scope.
 *
 * The seed a member keeps is a root; every pool derives its own identity from
 * it. That keeps one recovery string covering everything the member owns while
 * still giving Open and Verified unlinkable addresses — the property the pools
 * exist for.
 */
export async function workingSeedFor(root: Uint8Array, scope: VaultScope): Promise<Uint8Array> {
  const tag = scopeTag(scope);
  const material = new Uint8Array(root.length + tag.length);
  material.set(root);
  material.set(tag, root.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", material));
}

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

/**
 * Always via the working seed. Handing the root straight to the deriver would
 * make the address — and therefore the guard — a pure function of the envelope's
 * own contents, which is a check that can only ever agree with itself.
 */
async function metaAddressForScope(
  metaAddressFor: MetaAddressFor,
  root: Uint8Array,
  scope: VaultScope,
): Promise<string> {
  return metaAddressFor(await workingSeedFor(root, scope));
}

export class VaultAlreadyHereError extends Error {
  constructor() {
    super("This browser already holds a vault. Unlock it, or forget it first.");
    this.name = "VaultAlreadyHereError";
  }
}

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
  scope: VaultScope;
  seed: Uint8Array;
  passphrase: string;
  metaAddress: string;
}): Promise<string> {
  const passphrase = input.passphrase.trim();
  assertPassphrase(passphrase);
  const salt = newSalt();
  return encodeEnvelope(
    await wrapSeed({
      seed: input.seed,
      keyMaterial: deriveFromPassphrase(passphrase, salt),
      salt,
      guard: guardFor(input.metaAddress),
      aad: scopeTag(input.scope),
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
  /** Caller has shown the member what they are about to lose. */
  replaceExisting?: boolean;
}): Promise<{ seed: Uint8Array; metaAddress: string; recoveryString: string }> {
  assertPassphrase(input.passphrase.trim());
  if (!input.replaceExisting && readDeviceEnvelope(input.scope)) throw new VaultAlreadyHereError();
  const seed = newSeed();
  const metaAddress = await metaAddressForScope(input.metaAddressFor, seed, input.scope);

  const recoveryString = await buildRecoveryString({
    scope: input.scope,
    seed,
    passphrase: input.passphrase,
    metaAddress,
  });
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
      aad: scopeTag(input.scope),
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
  // A passkey failure has no passphrase behind it, and this screen has no field
  // to correct — pointing at one sends the member away from the recovery string,
  // which is the thing that would actually get them back in.
  const seed = await unwrapSeed(envelope, input.deviceKeyMaterial, scopeTag(input.scope)).catch(() => {
    throw new EnvelopeUnlockError(
      "This device's passkey no longer opens this vault. Restore from your recovery string.",
    );
  });
  const metaAddress = await metaAddressForScope(input.metaAddressFor, seed, input.scope);
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
    deriveFromPassphrase(input.passphrase.trim(), envelope.kdf.salt, envelope.kdf),
    scopeTag(input.scope),
  );
  const metaAddress = await metaAddressForScope(input.metaAddressFor, seed, input.scope);
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
  scope: VaultScope;
  seed: Uint8Array;
  metaAddress: string;
  nextPassphrase: string;
}): Promise<string> {
  return buildRecoveryString({
    scope: input.scope,
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
  assertPassphrase(input.passphrase.trim());
  const metaAddress = await metaAddressForScope(input.metaAddressFor, input.seed, input.scope);
  const recoveryString = await buildRecoveryString({
    scope: input.scope,
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
