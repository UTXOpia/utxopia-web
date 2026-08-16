/**
 * Vault envelope — the seed is random, the unlock factors only wrap it.
 *
 * Every prior design in this space derives the identity *from* a signature
 * (Umbra, Fluidkey, and our own `deriveKeys`). That binds three things that
 * should be separate: who you are, how you prove it, and what happens when the
 * proof changes. A signer swap, a passphrase change, or a provider silently
 * altering its message encoding all produce a different person — and the
 * symptom is an empty vault, not an error, because there is nothing to check
 * against. Umbra shipped a dedicated "fund recovery login page" for exactly
 * that, and the comment is still in their source.
 *
 * So: generate a random seed once, wrap it under as many unlock factors as the
 * member wants, and let every factor open the same seed. Changing a passphrase
 * re-wraps; adding a device adds a wrapping; losing the provider costs a
 * wrapping, not an identity. The AEAD tag doubles as the "wrong passphrase"
 * answer, so a bad unlock fails loudly instead of opening an empty stranger.
 */

import { argon2id } from "@noble/hashes/argon2";
import { bytesToHex, hexToBytes } from "@utxopia/sdk";

export const SEED_BYTES = 32;
const NONCE_BYTES = 12;
const SALT_BYTES = 16;

/**
 * FROZEN. The signed message is the account: change a byte and every member
 * derives a different unlock key and cannot open their own envelope. Add to it
 * only behind a new `kdfVersion`, never in place.
 */
const MESSAGE_TEMPLATE = (network: string, vault: string, secret: string) =>
  `Sign this message to unlock your UTXOpia vault.

WARNING: Only sign this in a client you trust.
Signing it anywhere else can cost you your funds.

Network: ${network}
Vault: ${vault}
Secret: ${secret}`;

/** FROZEN. HKDF domain separation. */
const HKDF_INFO = "utxopia:envelope:v1";

/**
 * Argon2id cost. Not frozen — carried in the envelope header so a member's
 * existing wrapping keeps opening at the parameters it was written with while
 * new wrappings get harder. Pure-JS argon2 runs on the member's phone during a
 * new-device restore, so this is a floor chosen to stay under a couple of
 * seconds there, not a ceiling.
 */
export const KDF_V1 = { name: "argon2id", m: 19456, t: 2, p: 1 } as const;

export interface EnvelopeKdf {
  name: string;
  m: number;
  t: number;
  p: number;
  /** Hex, per-envelope. */
  salt: string;
}

export interface VaultEnvelope {
  v: 1;
  kdf: EnvelopeKdf;
  aead: "AES-GCM";
  nonce: string;
  ct: string;
  /**
   * Expected stealth meta-address for the seed inside. Not a secret and not
   * load-bearing for decryption — it is the identity guard: an unlock that
   * produces a different address is a bug or a provider change, and must stop
   * rather than present an empty vault.
   */
  guard?: string;
}

export class EnvelopeUnlockError extends Error {
  constructor() {
    super("That passphrase does not match this account.");
    this.name = "EnvelopeUnlockError";
  }
}

export class EnvelopeIdentityError extends Error {
  constructor(readonly expected: string, readonly actual: string) {
    super("This unlock produced a different vault identity. Nothing was opened.");
    this.name = "EnvelopeIdentityError";
  }
}

export function newSeed(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SEED_BYTES));
}

/** The message the unlock factor signs. Exported so tests can pin it. */
export function buildUnlockMessage(input: {
  network: string;
  vault: string;
  secret: Uint8Array;
}): string {
  return MESSAGE_TEMPLATE(input.network, input.vault, bytesToHex(input.secret));
}

/**
 * Stretch the passphrase. The salt is per-envelope rather than derived from the
 * account id: two members who pick the same passphrase must not share work, and
 * a rewrap must not reuse the old salt.
 */
export function deriveSecret(
  passphrase: string,
  salt: Uint8Array,
  kdf: Pick<EnvelopeKdf, "m" | "t" | "p"> = KDF_V1,
): Uint8Array {
  return argon2id(new TextEncoder().encode(passphrase), salt, {
    m: kdf.m,
    t: kdf.t,
    p: kdf.p,
    dkLen: 32,
  });
}

/** HKDF the signature into an AES-GCM key. */
async function unlockKey(signature: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    signature as BufferSource,
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

export function newSalt(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(SALT_BYTES));
}

export async function wrapSeed(input: {
  seed: Uint8Array;
  signature: Uint8Array;
  salt: Uint8Array;
  kdf?: Pick<EnvelopeKdf, "name" | "m" | "t" | "p">;
  guard?: string;
}): Promise<VaultEnvelope> {
  const kdf = input.kdf ?? KDF_V1;
  const key = await unlockKey(input.signature);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ct = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce as BufferSource },
      key,
      input.seed as BufferSource,
    ),
  );
  return {
    v: 1,
    kdf: { ...kdf, salt: bytesToHex(input.salt) },
    aead: "AES-GCM",
    nonce: bytesToHex(nonce),
    ct: bytesToHex(ct),
    ...(input.guard ? { guard: input.guard } : {}),
  };
}

export async function unwrapSeed(
  envelope: VaultEnvelope,
  signature: Uint8Array,
): Promise<Uint8Array> {
  const key = await unlockKey(signature);
  try {
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: hexToBytes(envelope.nonce) as BufferSource },
      key,
      hexToBytes(envelope.ct) as BufferSource,
    );
    return new Uint8Array(plain);
  } catch {
    // AES-GCM tag failure is the only "wrong passphrase" signal there is, and
    // it is a real one — no separate verifier to store, and nothing an attacker
    // can test against without already holding the ciphertext.
    throw new EnvelopeUnlockError();
  }
}

/** Refuse an unlock that lands on a different identity. */
export function assertIdentity(envelope: VaultEnvelope, derivedMetaAddress: string): void {
  if (envelope.guard && envelope.guard !== derivedMetaAddress) {
    throw new EnvelopeIdentityError(envelope.guard, derivedMetaAddress);
  }
}
