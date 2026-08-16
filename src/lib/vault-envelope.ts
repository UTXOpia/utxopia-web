/**
 * Vault envelope — the seed is random, the unlock factors only wrap it.
 *
 * Every prior design in this space derives the identity *from* a signature
 * (Umbra, Fluidkey, and our own `deriveKeys`). That binds three things that
 * should move independently: who you are, how you prove it, and what happens
 * when the proof changes. A signer swap, a passphrase change, or a provider
 * quietly re-encoding its messages all produce a different person — and the
 * symptom is an empty vault, not an error, because there is nothing to check
 * against. Umbra shipped a dedicated "fund recovery login page" for exactly
 * that, and the comment is still in their source.
 *
 * So: one random seed, wrapped under as many unlock factors as the member
 * wants. Changing a passphrase re-wraps. Adding a device adds a wrapping. The
 * AEAD tag is the "wrong passphrase" answer, so a bad unlock fails loudly
 * instead of opening an empty stranger — and unlike a stored verifier, that tag
 * is only useful to someone already holding the ciphertext.
 *
 * Nothing here reaches a server, ours or anyone's. Two wrappings exist:
 *
 *   E_device  passkey PRF          on this device, every day
 *   E_string  argon2id(passphrase) the member keeps it, the only way to a new device
 *
 * Deliberately no provider-signed wrapping. It could only live on a device that
 * already has E_device, so it would never be the one that saves anybody — and
 * leaving it out keeps the login provider out of the vault's security model
 * entirely: taking over the member's email wins the attacker an app session and
 * nothing else.
 */

import { argon2id } from "@noble/hashes/argon2";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex, hexToBytes } from "@utxopia/sdk";

export const SEED_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;
const GUARD_BYTES = 8;
const CT_BYTES = SEED_BYTES + 16; // AES-GCM tag

/** FROZEN. HKDF domain separation. */
const HKDF_INFO = "utxopia:envelope:v1";

/** Recovery strings are prefixed so a member can tell what they are pasting. */
const STRING_PREFIX = "utxovault1";

/**
 * Argon2id cost. Not frozen — carried in the envelope so an existing wrapping
 * keeps opening at the cost it was written with while new ones get harder.
 * Pure-JS argon2 runs on the member's phone during a restore, so this is a
 * floor chosen to stay usable there (~125ms on a laptop), not a ceiling.
 */
export const KDF_V1 = { id: 1, m: 19456, t: 2, p: 1 } as const;

export interface VaultEnvelope {
  v: 1;
  kdf: { id: number; m: number; t: number; p: number; salt: Uint8Array };
  nonce: Uint8Array;
  ct: Uint8Array;
  /**
   * First 8 bytes of sha256(stealth meta-address). Not a secret and not needed
   * to decrypt — it catches the case the AEAD tag cannot: a correct passphrase
   * against a string belonging to a different vault.
   */
  guard: Uint8Array;
}

export class EnvelopeUnlockError extends Error {
  constructor() {
    super("That passphrase does not match this recovery string.");
    this.name = "EnvelopeUnlockError";
  }
}

export class EnvelopeIdentityError extends Error {
  constructor() {
    super("This recovery string belongs to a different vault. Nothing was opened.");
    this.name = "EnvelopeIdentityError";
  }
}

export class EnvelopeFormatError extends Error {
  constructor(detail: string) {
    super(`This does not look like a UTXOpia recovery string (${detail}).`);
    this.name = "EnvelopeFormatError";
  }
}

export function newSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SEED_BYTES));
}

export function newSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

export function guardFor(metaAddress: string): Uint8Array {
  return sha256(new TextEncoder().encode(metaAddress)).slice(0, GUARD_BYTES);
}

/**
 * Stretch the passphrase into key material. The salt is per-envelope rather
 * than derived from the account: two members who pick the same passphrase must
 * not share work, and a rewrap must not reuse the old salt.
 */
export function deriveFromPassphrase(
  passphrase: string,
  salt: Uint8Array,
  kdf: { m: number; t: number; p: number } = KDF_V1,
): Uint8Array {
  return argon2id(new TextEncoder().encode(passphrase), salt, {
    m: kdf.m,
    t: kdf.t,
    p: kdf.p,
    dkLen: 32,
  });
}

/** HKDF whatever the factor produced — argon2 output, PRF output — into an AES key. */
async function unlockKey(keyMaterial: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    keyMaterial as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: new Uint8Array(32),
      info: new TextEncoder().encode(HKDF_INFO),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function wrapSeed(input: {
  seed: Uint8Array;
  keyMaterial: Uint8Array;
  salt: Uint8Array;
  guard: Uint8Array;
  kdf?: { id: number; m: number; t: number; p: number };
}): Promise<VaultEnvelope> {
  const kdf = input.kdf ?? KDF_V1;
  const key = await unlockKey(input.keyMaterial);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      input.seed as BufferSource,
    ),
  );
  return { v: 1, kdf: { ...kdf, salt: input.salt }, nonce, ct, guard: input.guard };
}

export async function unwrapSeed(
  envelope: VaultEnvelope,
  keyMaterial: Uint8Array,
): Promise<Uint8Array> {
  const key = await unlockKey(keyMaterial);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: envelope.nonce as BufferSource },
      key,
      envelope.ct as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    throw new EnvelopeUnlockError();
  }
}

/** Refuse an unlock that lands on a different identity. */
export function assertIdentity(envelope: VaultEnvelope, metaAddress: string): void {
  const actual = guardFor(metaAddress);
  if (!envelope.guard.every((b, i) => b === actual[i])) throw new EnvelopeIdentityError();
}

// ---------------------------------------------------------------------------
// Portable form
//
// The member keeps this. It has to survive a password manager, a text message
// and a hand-written note, so it is packed binary rather than JSON: 92 bytes,
// about 123 characters. JSON of the same content is three times longer, and
// length is the difference between "I saved it" and "I'll do it later".
// ---------------------------------------------------------------------------

const PACKED_BYTES = 1 + 1 + 4 + 1 + 1 + SALT_BYTES + NONCE_BYTES + CT_BYTES + GUARD_BYTES;

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function unBase64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  return Uint8Array.from(binary, (c) => c.charCodeAt(0));
}

function pack(envelope: VaultEnvelope): Uint8Array {
  const out = new Uint8Array(PACKED_BYTES);
  const view = new DataView(out.buffer);
  out[0] = envelope.v;
  out[1] = envelope.kdf.id;
  view.setUint32(2, envelope.kdf.m, true);
  out[6] = envelope.kdf.t;
  out[7] = envelope.kdf.p;
  out.set(envelope.kdf.salt, 8);
  out.set(envelope.nonce, 8 + SALT_BYTES);
  out.set(envelope.ct, 8 + SALT_BYTES + NONCE_BYTES);
  out.set(envelope.guard, 8 + SALT_BYTES + NONCE_BYTES + CT_BYTES);
  return out;
}

function unpack(bytes: Uint8Array): VaultEnvelope {
  if (bytes.length !== PACKED_BYTES) {
    throw new EnvelopeFormatError(`expected ${PACKED_BYTES} bytes, got ${bytes.length}`);
  }
  if (bytes[0] !== 1) throw new EnvelopeFormatError(`unknown version ${bytes[0]}`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return {
    v: 1,
    kdf: {
      id: bytes[1],
      m: view.getUint32(2, true),
      t: bytes[6],
      p: bytes[7],
      salt: bytes.slice(8, 8 + SALT_BYTES),
    },
    nonce: bytes.slice(8 + SALT_BYTES, 8 + SALT_BYTES + NONCE_BYTES),
    ct: bytes.slice(8 + SALT_BYTES + NONCE_BYTES, 8 + SALT_BYTES + NONCE_BYTES + CT_BYTES),
    guard: bytes.slice(8 + SALT_BYTES + NONCE_BYTES + CT_BYTES),
  };
}

/** What the member keeps. Prefixed so they can tell what they are looking at. */
export function encodeEnvelope(envelope: VaultEnvelope): string {
  return `${STRING_PREFIX}${base64url(pack(envelope))}`;
}

export function decodeEnvelope(text: string): VaultEnvelope {
  const trimmed = text.trim().replace(/\s+/g, "");
  if (!trimmed.startsWith(STRING_PREFIX)) throw new EnvelopeFormatError("wrong prefix");
  try {
    return unpack(unBase64url(trimmed.slice(STRING_PREFIX.length)));
  } catch (caught) {
    if (caught instanceof EnvelopeFormatError) throw caught;
    throw new EnvelopeFormatError("not valid base64");
  }
}

/** Device-wrapping storage form — same bytes, hex so devtools stays readable. */
export const envelopeToHex = (envelope: VaultEnvelope): string => bytesToHex(pack(envelope));
export const envelopeFromHex = (hex: string): VaultEnvelope => unpack(hexToBytes(hex));
