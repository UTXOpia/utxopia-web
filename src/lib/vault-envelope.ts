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
 * Nothing here reaches a server, ours or anyone's. Three wrappings exist:
 *
 *   E_device  passkey PRF              on this device, every day
 *   E_login   argon2id(PIN, signature) same job, where PRF is unavailable
 *   E_string  argon2id(passphrase)     the member keeps it, the only way to a new device
 *
 * E_login exists because a browser without PRF got no daily wrapping at all and
 * had to be handed the recovery string every visit — which is how a string that
 * should be written down once ends up pasted out of a notes app twice a day.
 *
 * It is a real trade and not a free one. An earlier version of this comment
 * argued for keeping the login provider out of the model entirely, on the
 * grounds that taking over the member's email would then win an attacker an app
 * session and nothing else. Where E_login is armed that is no longer true: a
 * stolen session yields one signature, and a signature beside this ciphertext
 * puts a six-digit PIN within offline reach. So the PIN is not what makes
 * E_login safe — E_string is still the only factor carrying real entropy, and
 * E_login is deliberately never the only wrapping a member has.
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
 * FROZEN. What the login provider signs, and the whole of what it learns.
 *
 * Every member on a network signs this exact string. It carries no address, no
 * salt and nothing derived from the PIN, so the provider cannot tell two
 * members apart by it and cannot link a social account to an on-chain identity
 * — which for a pool whose entire purpose is unlinkability is the property that
 * matters most here. That is why the PIN is mixed in afterwards (see
 * `deriveFromPin`) rather than committed to inside the message: a per-member
 * string here would be an offline oracle for exactly the pair the pools exist
 * to keep apart.
 *
 * `Vault: root` rather than a pool id, because there is one root and both
 * pools' wrappings hold it. Scoping the message per pool would cost a second
 * signature prompt and separate nothing — `wrapSeed` already folds the scope
 * into the HKDF info and the AEAD's additional data, so one signature produces
 * a different key in each pool by construction.
 *
 * The network is in it: a devnet signature must not open a mainnet wrapping.
 *
 * Change a byte and every wrapping written under the old text stops opening.
 * Treat that the way Umbra had to treat eth_sign -> personal_sign.
 */
const MESSAGE_TEMPLATE = (network: string) =>
  `Sign this message to unlock your UTXOpia vault.

WARNING: Only sign this in a client you trust.
Signing it anywhere else can cost you your funds.

Network: solana:${network}
Vault: root`;

/** The message the login provider signs. Exported so a test can pin it. */
export function buildUnlockMessage(network: string): string {
  return MESSAGE_TEMPLATE(network);
}

/**
 * Argon2id cost. Not frozen — carried in the envelope so an existing wrapping
 * keeps opening at the cost it was written with while new ones get harder.
 * Pure-JS argon2 runs on the member's phone during a restore, so this is a
 * floor chosen to stay usable there (~125ms on a laptop), not a ceiling.
 */
export const KDF_V1 = { id: 1, m: 19456, t: 2, p: 1 } as const;

/**
 * Bounds on the cost parameters carried inside a string.
 *
 * The header is attacker-supplied — anyone can hand a member a string and ask
 * them to paste it. The upper bound stops a pasted string from asking the
 * browser for terabytes; the lower bound stops one from claiming a cost so
 * small that it silently trains a member to accept a weak wrapping as normal.
 */
const KDF_LIMITS = { m: [8192, 262144], t: [1, 16], p: [1, 4] } as const;

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
  constructor(message = "That passphrase does not match this recovery string.") {
    super(message);
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

/**
 * Argon2id cost for the PIN. Heavier than KDF_V1 on purpose.
 *
 * KDF_V1 has to stay usable during a restore on a member's phone, in a panic,
 * possibly on the worst hardware they own. This one runs once, on a device the
 * member already uses daily, behind a login they have just completed — so it
 * can afford four times the memory, and a six-digit secret needs every bit of
 * it. ~600ms on an M-series laptop.
 */
const PIN_KDF = { m: 65536, t: 3, p: 1 } as const;

export const MIN_PIN_LENGTH = 6;

export class WeakPinError extends Error {
  constructor() {
    super(`Use at least ${MIN_PIN_LENGTH} characters.`);
    this.name = "WeakPinError";
  }
}

/**
 * Key material for E_login: the PIN stretched under the provider's signature.
 *
 * The signature is the salt. That is what lets the second factor be six digits
 * — it is high-entropy, stable for a member, and unlike a stored salt it is not
 * sitting on the device beside the ciphertext, so there is nothing to attack
 * until the signature itself leaks. It also means nothing new has to be stored:
 * `armDevice` keeps its own salt for HKDF and needs no field for this one.
 *
 * Separate from `deriveFromPassphrase` on purpose, and deliberately not a thin
 * wrapper over it. A PIN must never end up wrapping a recovery string, and the
 * way to guarantee that is for the two to share no code path at all.
 */
export function assertPin(pin: string): void {
  if (pin.trim().length < MIN_PIN_LENGTH) throw new WeakPinError();
}

export function deriveFromPin(pin: string, signature: Uint8Array): Uint8Array {
  assertPin(pin);
  return argon2id(new TextEncoder().encode(pin.trim()), sha256(signature), {
    m: PIN_KDF.m,
    t: PIN_KDF.t,
    p: PIN_KDF.p,
    dkLen: 32,
  });
}

/**
 * HKDF whatever the factor produced — argon2 output, PRF output — into an AES
 * key.
 *
 * The envelope's salt and the scope both go in. The passkey path supplies the
 * same key material every time, so without the salt a re-arm would reuse one
 * key forever; without the scope, one pool's wrapping would open under another.
 */
async function unlockKey(
  keyMaterial: Uint8Array,
  salt: Uint8Array,
  aad: Uint8Array,
): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    keyMaterial as BufferSource,
    "HKDF",
    false,
    ["deriveKey"],
  );
  const info = new Uint8Array([...new TextEncoder().encode(`${HKDF_INFO}|`), ...aad]);
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: salt as BufferSource, info: info as BufferSource },
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
  /** Bound into the AEAD, so a wrapping cannot be opened under another scope. */
  aad: Uint8Array;
  kdf?: { id: number; m: number; t: number; p: number };
}): Promise<VaultEnvelope> {
  const kdf = input.kdf ?? KDF_V1;
  const key = await unlockKey(input.keyMaterial, input.salt, input.aad);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource, additionalData: input.aad as BufferSource },
      key,
      input.seed as BufferSource,
    ),
  );
  return { v: 1, kdf: { ...kdf, salt: input.salt }, nonce, ct, guard: input.guard };
}

export async function unwrapSeed(
  envelope: VaultEnvelope,
  keyMaterial: Uint8Array,
  aad: Uint8Array,
): Promise<Uint8Array> {
  const key = await unlockKey(keyMaterial, envelope.kdf.salt, aad);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: envelope.nonce as BufferSource, additionalData: aad as BufferSource },
      key,
      envelope.ct as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    throw new EnvelopeUnlockError();
  }
}

/**
 * Refuse an unlock that lands on a different identity.
 *
 * `metaAddress` must be derived with the *scope* folded in, or this check is
 * tautological: the address would be a pure function of the seed inside the
 * envelope being checked, so the guard would reproduce itself and always pass.
 */
export function assertIdentity(envelope: VaultEnvelope, metaAddress: string): void {
  const actual = guardFor(metaAddress);
  if (envelope.guard.length !== GUARD_BYTES) throw new EnvelopeIdentityError();
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
  if (bytes[1] !== KDF_V1.id) throw new EnvelopeFormatError(`unknown key derivation ${bytes[1]}`);

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const kdf = { id: bytes[1], m: view.getUint32(2, true), t: bytes[6], p: bytes[7] };
  for (const [name, [low, high]] of Object.entries(KDF_LIMITS)) {
    const value = kdf[name as keyof typeof KDF_LIMITS];
    if (value < low || value > high) {
      throw new EnvelopeFormatError(`${name}=${value} is outside the supported range`);
    }
  }

  return {
    v: 1,
    kdf: {
      ...kdf,
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
