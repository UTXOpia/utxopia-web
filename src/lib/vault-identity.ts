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
  decodeRecoveryString,
  encodeRecoveryString,
  envelopeFromHex,
  envelopeToHex,
  guardFor,
  newSalt,
  newStringKey,
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
  localStorage.removeItem(signerKey(scope));
}

// ---------------------------------------------------------------------------
// Which login armed this device
//
// A device-local note, not part of the envelope: the packed format is what
// recovery strings are made of, and it does not grow a field for something only
// this browser cares about.
//
// It does two jobs. It is the tell for which unlock this browser should offer,
// since a wrapping alone cannot say whether PRF or a signature produced it. And
// it is the error message: a member whose provider hands them a different
// embedded wallet would otherwise be told "this device's passkey no longer
// opens this vault", which names the wrong factor on a screen with nothing to
// act on — the empty-vault-instead-of-an-error failure this whole module was
// written to avoid.
// ---------------------------------------------------------------------------

const DEVICE_SIGNER_PREFIX = "utxo:signer:v1:";

function signerKey(scope: VaultScope): string {
  return `${DEVICE_SIGNER_PREFIX}${scope.networkId}:${scope.vaultId}`;
}

export class SignerChangedError extends Error {
  constructor() {
    super(
      "This vault was set up under a different login. Sign in with that account, or restore from your recovery string.",
    );
    this.name = "SignerChangedError";
  }
}

export function readDeviceSigner(scope: VaultScope): string | null {
  if (typeof window === "undefined") return null;
  return localStorage.getItem(signerKey(scope));
}

export function writeDeviceSigner(scope: VaultScope, signer: string): void {
  localStorage.setItem(signerKey(scope), signer);
}

/** Call before signing, so a swapped wallet fails naming the real cause. */
export function assertDeviceSigner(scope: VaultScope, signer: string): void {
  const known = readDeviceSigner(scope);
  if (known && known !== signer) throw new SignerChangedError();
}

/** Has this browser ever held a vault for this scope? Drives "restore or create". */
export function hasDeviceEnvelope(scope: VaultScope): boolean {
  return readDeviceEnvelope(scope) !== null;
}

/**
 * Wrap a seed under a fresh random key and put both in one string.
 *
 * Every call mints a new key as well as a new salt, so an old string keeps
 * opening under its own key and a new one is not a re-encoding of it. That is
 * the same property the passphrase version had, and the same caveat: a string
 * already written down cannot be revoked. Rotating the seed is the only thing
 * that retires one.
 */
export async function buildRecoveryString(input: {
  scope: VaultScope;
  seed: Uint8Array;
  metaAddress: string;
}): Promise<string> {
  const key = newStringKey();
  return encodeRecoveryString(
    await wrapSeed({
      seed: input.seed,
      keyMaterial: key,
      salt: newSalt(),
      guard: guardFor(input.metaAddress),
      aad: scopeTag(input.scope),
    }),
    key,
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
  /** The salt the login signature was bound to, when a login armed this device. */
  salt?: Uint8Array;
}): Promise<{ seed: Uint8Array; metaAddress: string; recoveryString: string }> {
  if (!input.replaceExisting && readDeviceEnvelope(input.scope)) throw new VaultAlreadyHereError();
  const seed = newSeed();
  const metaAddress = await metaAddressForScope(input.metaAddressFor, seed, input.scope);

  const recoveryString = await buildRecoveryString({ scope: input.scope, seed, metaAddress });
  if (input.deviceKeyMaterial) {
    await armDevice({
      scope: input.scope,
      seed,
      metaAddress,
      deviceKeyMaterial: input.deviceKeyMaterial,
      salt: input.salt,
    });
  }

  return { seed, metaAddress, recoveryString };
}

/**
 * One wrapping of a seed under whatever factor produced the key material.
 *
 * Separate from `armDevice` because not every wrapping is written here any
 * more: the login wrapping is published to a server so a device that has never
 * seen this vault has something to open (`lib/vault-remote`). Same seal, same
 * scope binding, different destination — and the destination is the caller's
 * business, not this function's.
 */
export async function sealEnvelope(input: {
  scope: VaultScope;
  seed: Uint8Array;
  metaAddress: string;
  keyMaterial: Uint8Array;
  /**
   * The salt this wrapping is written under, minted by the caller rather than
   * here. The login path signs a message carrying it, so the key material
   * arriving above was already derived from this exact value — generating a
   * fresh one now would seal the envelope under a salt nothing can reproduce.
   */
  salt: Uint8Array;
}): Promise<VaultEnvelope> {
  return wrapSeed({
    seed: input.seed,
    keyMaterial: input.keyMaterial,
    salt: input.salt,
    guard: guardFor(input.metaAddress),
    aad: scopeTag(input.scope),
  });
}

/** Add (or replace) this device's daily wrapping for a seed already in hand. */
export async function armDevice(input: {
  scope: VaultScope;
  seed: Uint8Array;
  metaAddress: string;
  deviceKeyMaterial: Uint8Array;
  /** Omitted by the passkey path, whose key material does not depend on one. */
  salt?: Uint8Array;
}): Promise<void> {
  writeDeviceEnvelope(
    input.scope,
    await sealEnvelope({
      ...input,
      keyMaterial: input.deviceKeyMaterial,
      salt: input.salt ?? newSalt(),
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
  /**
   * Which factor produced the key material. It changes nothing about the
   * unlock and everything about what a failure is allowed to say.
   */
  factor?: "passkey" | "pin";
}): Promise<{ seed: Uint8Array; metaAddress: string }> {
  const envelope = readDeviceEnvelope(input.scope);
  if (!envelope) throw new NoDeviceEnvelopeError();
  // A wrong factor cannot open a different vault: the seed is unwrapped, never
  // derived, so the AEAD tag fails and this throws. That is the whole reason
  // the seed is wrapped rather than derived from whatever the member typed.
  //
  // What the failure says has to match the factor, though. A passkey failure
  // has nothing on screen to correct, so it points at the recovery string. A
  // PIN failure has a field right there, and sending that member to their
  // recovery string instead is telling them to use the nuclear option over a
  // typo.
  const seed = await unwrapSeed(envelope, input.deviceKeyMaterial, scopeTag(input.scope)).catch(() => {
    throw new EnvelopeUnlockError(
      input.factor === "pin"
        ? "That PIN does not open this vault. Try again."
        : "This device's passkey no longer opens this vault. Restore from your recovery string.",
    );
  });
  const metaAddress = await metaAddressForScope(input.metaAddressFor, seed, input.scope);
  assertIdentity(envelope, metaAddress);
  return { seed, metaAddress };
}

/**
 * New device. Arms this browser on success so the member pastes the string
 * once rather than every session.
 */
export async function unlockWithRecoveryString(input: {
  scope: VaultScope;
  recoveryString: string;
  deviceKeyMaterial?: Uint8Array;
  salt?: Uint8Array;
  metaAddressFor: MetaAddressFor;
}): Promise<{ seed: Uint8Array; metaAddress: string }> {
  const { envelope, key } = decodeRecoveryString(input.recoveryString);
  return unlockWithEnvelope({ ...input, envelope, keyMaterial: key });
}

/**
 * Open a wrapping this device did not write, from wherever it came.
 *
 * The recovery string is one such wrapping; the one fetched from the blob
 * store is another. Both need the same three things afterwards and none of them
 * are optional: the guard has to be checked against a derived address, the
 * device has to be armed so this happens once rather than every visit, and a
 * failure must not leave a stranger's identity half-loaded.
 */
export async function unlockWithEnvelope(input: {
  scope: VaultScope;
  envelope: VaultEnvelope;
  keyMaterial: Uint8Array;
  deviceKeyMaterial?: Uint8Array;
  /** Present when a login is what will arm this device. */
  salt?: Uint8Array;
  metaAddressFor: MetaAddressFor;
}): Promise<{ seed: Uint8Array; metaAddress: string }> {
  const seed = await unwrapSeed(input.envelope, input.keyMaterial, scopeTag(input.scope));
  const metaAddress = await metaAddressForScope(input.metaAddressFor, seed, input.scope);
  assertIdentity(input.envelope, metaAddress);

  if (input.deviceKeyMaterial) {
    await armDevice({
      scope: input.scope,
      seed,
      metaAddress,
      deviceKeyMaterial: input.deviceKeyMaterial,
      salt: input.salt,
    });
  }
  return { seed, metaAddress };
}

/**
 * Bring an identity that predates envelopes under one, keeping the identity.
 * The seed is whatever already produced this member's notes — wrapping it does
 * not move anything, which is the point.
 */
export async function adoptExistingSeed(input: {
  scope: VaultScope;
  seed: Uint8Array;
  deviceKeyMaterial?: Uint8Array;
  metaAddressFor: MetaAddressFor;
  /** Caller has shown the member the identity they are about to write over. */
  replaceExisting?: boolean;
}): Promise<{ metaAddress: string; recoveryString: string }> {
  // The seed arrives from somewhere with no tag to check it against, so
  // refusing to write over a wrapping this browser already holds is the only
  // thing between a wrong one and the member's real vault.
  if (!input.replaceExisting && readDeviceEnvelope(input.scope)) throw new VaultAlreadyHereError();
  const metaAddress = await metaAddressForScope(input.metaAddressFor, input.seed, input.scope);
  const recoveryString = await buildRecoveryString({
    scope: input.scope,
    seed: input.seed,
    metaAddress,
  });
  if (input.deviceKeyMaterial) {
    await armDevice({
      scope: input.scope,
      seed: input.seed,
      metaAddress,
      deviceKeyMaterial: input.deviceKeyMaterial,
    });
  }
  return { metaAddress, recoveryString };
}

export { EnvelopeIdentityError };
