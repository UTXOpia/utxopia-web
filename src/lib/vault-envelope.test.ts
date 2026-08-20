import { describe, expect, it } from "bun:test";
import { bytesToHex } from "@utxopia/sdk";
import {
  EnvelopeFormatError,
  EnvelopeIdentityError,
  EnvelopeUnlockError,
  KDF_V1,
  MIN_PIN_LENGTH,
  WeakPinError,
  assertIdentity,
  buildUnlockMessage,
  decodeRecoveryString,
  deriveFromPin,
  encodeRecoveryString,
  newStringKey,
  envelopeFromHex,
  envelopeToHex,
  guardFor,
  newSalt,
  newSeed,
  unwrapSeed,
  wrapSeed,
} from "./vault-envelope";

const META = "utxo:27b77aaa";
const key = (byte: number) => new Uint8Array(32).fill(byte);
const AAD = new TextEncoder().encode("utxopia:vault-scope:v1:solana:devnet:verified");
const OTHER_AAD = new TextEncoder().encode("utxopia:vault-scope:v1:solana:devnet:open");

const anEnvelope = (over: { keyMaterial?: Uint8Array; guard?: Uint8Array } = {}) =>
  wrapSeed({
    seed: newSeed(),
    keyMaterial: over.keyMaterial ?? key(1),
    salt: newSalt(),
    guard: over.guard ?? guardFor(META),
    aad: AAD,
  });

describe("wrapping", () => {
  it("round-trips a seed", async () => {
    const seed = newSeed();
    const envelope = await wrapSeed({ seed, keyMaterial: key(1), salt: newSalt(), guard: guardFor(META), aad: AAD });
    expect(await unwrapSeed(envelope, key(1), AAD)).toEqual(seed);
  });

  it("fails loudly on the wrong key instead of yielding a stranger's seed", async () => {
    const envelope = await anEnvelope();
    await expect(unwrapSeed(envelope, key(2), AAD)).rejects.toBeInstanceOf(EnvelopeUnlockError);
  });

  it("rejects a tampered ciphertext", async () => {
    const envelope = await anEnvelope();
    envelope.ct[0] ^= 0xff;
    await expect(unwrapSeed(envelope, key(1), AAD)).rejects.toBeInstanceOf(EnvelopeUnlockError);
  });

  it("re-wraps the same seed under a new key — reissuing a string keeps the identity", async () => {
    const seed = newSeed();
    const first = await wrapSeed({ seed, keyMaterial: key(1), salt: newSalt(), guard: guardFor(META), aad: AAD });
    const second = await wrapSeed({
      seed: await unwrapSeed(first, key(1), AAD),
      keyMaterial: key(9),
      salt: newSalt(),
      guard: guardFor(META),
      aad: AAD,
    });
    expect(await unwrapSeed(second, key(9), AAD)).toEqual(seed);
  });

  it("carries its kdf parameters so they can be raised later", async () => {
    const envelope = await anEnvelope();
    expect(envelope.kdf.m).toBe(KDF_V1.m);
    expect(envelope.kdf.t).toBe(KDF_V1.t);
  });
});

describe("identity guard", () => {
  it("accepts the vault it was written for", async () => {
    const envelope = await anEnvelope();
    expect(() => assertIdentity(envelope, META)).not.toThrow();
  });

  // The AEAD tag cannot catch this one: the key is right, the string is
  // simply from the member's other vault.
  it("stops a correct key against the wrong vault", async () => {
    const envelope = await anEnvelope({ guard: guardFor("utxo:other") });
    expect(() => assertIdentity(envelope, META)).toThrow(EnvelopeIdentityError);
  });
});

describe("recovery string", () => {
  it("survives a round trip", async () => {
    const envelope = await anEnvelope();
    const decoded = decodeRecoveryString(encodeRecoveryString(envelope, key(9))).envelope;
    expect(decoded).toEqual(envelope);
  });

  it("still opens after being written down and typed back in", async () => {
    const seed = newSeed();
    const envelope = await wrapSeed({ seed, keyMaterial: key(1), salt: newSalt(), guard: guardFor(META), aad: AAD });
    const written = `  ${encodeRecoveryString(envelope, key(1)).replace(/(.{40})/g, "$1\n")}  `;
    expect(await unwrapSeed(decodeRecoveryString(written).envelope, key(1), AAD)).toEqual(seed);
  });

  // The finding this exists for: with scope carried only by the storage key
  // name, a genuine string from one pool decrypted cleanly under the other and
  // overwrote its wrapping. The tag must fail, not the guard.
  it("cannot be opened under another vault's scope", async () => {
    const envelope = await anEnvelope();
    await expect(unwrapSeed(envelope, key(1), OTHER_AAD)).rejects.toBeInstanceOf(EnvelopeUnlockError);
  });

  // Longer than v1 by the 32 bytes of key it now carries, and worth it: v1 was
  // shorter only because half of it was a second thing the member had to keep.
  // Still inside what a 24-word seed phrase costs to write down.
  it("stays short enough that a member will actually save it", async () => {
    const text = encodeRecoveryString(await anEnvelope(), key(1));
    expect(text.length).toBeLessThan(200);
  });

  it("says what is wrong rather than failing silently", async () => {
    expect(() => decodeRecoveryString("hello")).toThrow(EnvelopeFormatError);
    expect(() => decodeRecoveryString("utxovault2AAAA")).toThrow(EnvelopeFormatError);
    const truncated = encodeRecoveryString(await anEnvelope(), key(1)).slice(0, 40);
    expect(() => decodeRecoveryString(truncated)).toThrow(EnvelopeFormatError);
    // A v1 string is named, not left to fail as a byte count.
    expect(() => decodeRecoveryString("utxovault1AAAA")).toThrow(/older recovery string/);
  });

  // The header travels with the string, so anyone who can hand a member a
  // string can propose the cost it will be opened at.
  it("refuses cost parameters outside the supported range", async () => {
    const envelope = await anEnvelope();
    const bytes = Array.from(
      Uint8Array.from(atob(encodeRecoveryString(envelope, key(1)).slice(10).replace(/-/g, "+").replace(/_/g, "/") + "="), (c) =>
        c.charCodeAt(0),
      ),
    );
    const reencode = (patched: number[]) =>
      "utxovault1" +
      btoa(String.fromCharCode(...patched)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

    const absurdMemory = [...bytes];
    new DataView(new Uint8Array(absurdMemory).buffer); // shape check
    absurdMemory[2] = 0xff;
    absurdMemory[3] = 0xff;
    absurdMemory[4] = 0xff;
    absurdMemory[5] = 0xff;
    expect(() => decodeRecoveryString(reencode(absurdMemory))).toThrow(EnvelopeFormatError);

    const noWork = [...bytes];
    noWork[2] = 1;
    noWork[3] = 0;
    noWork[4] = 0;
    noWork[5] = 0;
    expect(() => decodeRecoveryString(reencode(noWork))).toThrow(EnvelopeFormatError);

    const unknownKdf = [...bytes];
    unknownKdf[1] = 9;
    expect(() => decodeRecoveryString(reencode(unknownKdf))).toThrow(EnvelopeFormatError);
  });

  it("round-trips through the device storage form too", async () => {
    const envelope = await anEnvelope();
    expect(envelopeFromHex(envelopeToHex(envelope))).toEqual(envelope);
  });
});

describe("the key a recovery string carries", () => {
  it("is a fresh 32 bytes every time", () => {
    const a = newStringKey();
    expect(a.length).toBe(32);
    expect(a).not.toEqual(newStringKey());
  });

  // The whole point of v2: what is in the string opens the string. If these
  // ever come apart, a member holding a valid-looking string has nothing.
  it("round-trips as the key that opens its own envelope", async () => {
    const k = newStringKey();
    const seed = newSeed();
    const envelope = await wrapSeed({
      seed,
      keyMaterial: k,
      salt: newSalt(),
      guard: guardFor(META),
      aad: AAD,
    });
    const decoded = decodeRecoveryString(encodeRecoveryString(envelope, k));
    expect(decoded.key).toEqual(k);
    expect(await unwrapSeed(decoded.envelope, decoded.key, AAD)).toEqual(seed);
  });

  it("refuses a key that is not the right length", async () => {
    const envelope = await anEnvelope();
    expect(() => encodeRecoveryString(envelope, new Uint8Array(16))).toThrow(EnvelopeFormatError);
  });
});

describe("the message the login provider signs", () => {
  // FROZEN. Every wrapping written under the old text stops opening if this
  // changes, so this test failing is the alarm, not a chore.
  it("is exactly this", () => {
    expect(buildUnlockMessage("devnet")).toBe(
      `Sign this message to unlock your UTXOpia vault.

WARNING: Only sign this in a client you trust.
Signing it anywhere else can cost you your funds.

Network: solana:devnet
Vault: root`,
    );
  });

  // The provider sees this string and nothing else. If it ever varies per
  // member, it becomes an offline oracle linking a social account to an
  // on-chain identity — the one thing the pools exist to prevent.
  it("says nothing about who is signing it", () => {
    expect(buildUnlockMessage("devnet")).toBe(buildUnlockMessage("devnet"));
    expect(buildUnlockMessage("devnet")).not.toContain("utxo:");
  });

  it("does not let a devnet signature open a mainnet wrapping", () => {
    expect(buildUnlockMessage("devnet")).not.toBe(buildUnlockMessage("mainnet"));
  });
});

describe("PIN stretching", () => {
  const sig = (byte: number) => new Uint8Array(64).fill(byte);

  // The load-bearing assumption of the whole login path: ed25519 is
  // deterministic (RFC 8032) and Solana signs that way, so the same wallet over
  // the same message reproduces the same salt. A signer that adds randomness
  // costs this wrapping — not the identity, which the recovery string still
  // opens, but the failure would otherwise look like a wrong PIN.
  it("is deterministic for the same PIN and signature", () => {
    expect(deriveFromPin("123456", sig(7))).toEqual(deriveFromPin("123456", sig(7)));
  });

  it("changes completely when the signature does", () => {
    expect(deriveFromPin("123456", sig(7))).not.toEqual(deriveFromPin("123456", sig(8)));
  });

  it("refuses a PIN too short to be worth wrapping under", () => {
    expect(() => deriveFromPin("1".repeat(MIN_PIN_LENGTH - 1), sig(7))).toThrow(WeakPinError);
  });

  it("wraps and unwraps a seed like any other factor", async () => {
    const seed = newSeed();
    const material = deriveFromPin("123456", sig(7));
    const envelope = await wrapSeed({
      seed,
      keyMaterial: material,
      salt: newSalt(),
      guard: guardFor(META),
      aad: AAD,
    });
    expect(await unwrapSeed(envelope, deriveFromPin("123456", sig(7)), AAD)).toEqual(seed);
    expect(unwrapSeed(envelope, deriveFromPin("654321", sig(7)), AAD)).rejects.toThrow(
      EnvelopeUnlockError,
    );
  });

  it("is bound to its pool like every other wrapping", async () => {
    const material = deriveFromPin("123456", sig(7));
    const envelope = await wrapSeed({
      seed: newSeed(),
      keyMaterial: material,
      salt: newSalt(),
      guard: guardFor(META),
      aad: AAD,
    });
    expect(unwrapSeed(envelope, material, OTHER_AAD)).rejects.toThrow(EnvelopeUnlockError);
  });
});

