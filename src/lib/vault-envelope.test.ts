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
  decodeEnvelope,
  ROOT_KDF,
  buildRootMessage,
  deriveFromPassphrase,
  deriveFromPin,
  rootFromSignature,
  rootSaltFor,
  unlockCommit,
  encodeEnvelope,
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

  it("re-wraps the same seed under a new key — changing a passphrase keeps the identity", async () => {
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

  // The AEAD tag cannot catch this one: the passphrase is right, the string is
  // simply from the member's other vault.
  it("stops a correct passphrase against the wrong vault", async () => {
    const envelope = await anEnvelope({ guard: guardFor("utxo:other") });
    expect(() => assertIdentity(envelope, META)).toThrow(EnvelopeIdentityError);
  });
});

describe("recovery string", () => {
  it("survives a round trip", async () => {
    const envelope = await anEnvelope();
    const decoded = decodeEnvelope(encodeEnvelope(envelope));
    expect(decoded).toEqual(envelope);
  });

  it("still opens after being written down and typed back in", async () => {
    const seed = newSeed();
    const envelope = await wrapSeed({ seed, keyMaterial: key(1), salt: newSalt(), guard: guardFor(META), aad: AAD });
    const written = `  ${encodeEnvelope(envelope).replace(/(.{40})/g, "$1\n")}  `;
    expect(await unwrapSeed(decodeEnvelope(written), key(1), AAD)).toEqual(seed);
  });

  // The finding this exists for: with scope carried only by the storage key
  // name, a genuine string from one pool decrypted cleanly under the other and
  // overwrote its wrapping. The tag must fail, not the guard.
  it("cannot be opened under another vault's scope", async () => {
    const envelope = await anEnvelope();
    await expect(unwrapSeed(envelope, key(1), OTHER_AAD)).rejects.toBeInstanceOf(EnvelopeUnlockError);
  });

  it("stays short enough that a member will actually save it", async () => {
    const text = encodeEnvelope(await anEnvelope());
    expect(text.length).toBeLessThan(140);
  });

  it("says what is wrong rather than failing silently", async () => {
    expect(() => decodeEnvelope("hello")).toThrow(EnvelopeFormatError);
    expect(() => decodeEnvelope("utxovault1AAAA")).toThrow(EnvelopeFormatError);
    const truncated = encodeEnvelope(await anEnvelope()).slice(0, 40);
    expect(() => decodeEnvelope(truncated)).toThrow(EnvelopeFormatError);
  });

  // The header travels with the string, so anyone who can hand a member a
  // string can propose the cost it will be opened at.
  it("refuses cost parameters outside the supported range", async () => {
    const envelope = await anEnvelope();
    const bytes = Array.from(
      Uint8Array.from(atob(encodeEnvelope(envelope).slice(10).replace(/-/g, "+").replace(/_/g, "/") + "="), (c) =>
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
    expect(() => decodeEnvelope(reencode(absurdMemory))).toThrow(EnvelopeFormatError);

    const noWork = [...bytes];
    noWork[2] = 1;
    noWork[3] = 0;
    noWork[4] = 0;
    noWork[5] = 0;
    expect(() => decodeEnvelope(reencode(noWork))).toThrow(EnvelopeFormatError);

    const unknownKdf = [...bytes];
    unknownKdf[1] = 9;
    expect(() => decodeEnvelope(reencode(unknownKdf))).toThrow(EnvelopeFormatError);
  });

  it("round-trips through the device storage form too", async () => {
    const envelope = await anEnvelope();
    expect(envelopeFromHex(envelopeToHex(envelope))).toEqual(envelope);
  });
});

describe("passphrase stretching", () => {
  it("is deterministic for the same passphrase and salt", () => {
    const salt = newSalt();
    expect(deriveFromPassphrase("correct horse battery staple", salt)).toEqual(
      deriveFromPassphrase("correct horse battery staple", salt),
    );
  });

  it("separates members who picked the same passphrase", () => {
    expect(deriveFromPassphrase("hunter2", newSalt())).not.toEqual(
      deriveFromPassphrase("hunter2", newSalt()),
    );
  });

  it("costs enough to be worth having but stays usable on a phone", () => {
    const started = performance.now();
    deriveFromPassphrase("correct horse battery staple", newSalt());
    const elapsed = performance.now() - started;
    // Brute-force resistance is what this buys; a restore that feels broken is
    // what it must not cost. Both bounds are load-bearing.
    expect(elapsed).toBeGreaterThan(20);
    expect(elapsed).toBeLessThan(4000);
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

describe("rebuilding a root from the login", () => {
  const sig = (byte: number) => new Uint8Array(64).fill(byte);
  const secretFor = (passphrase: string, account: string) =>
    deriveFromPassphrase(passphrase, rootSaltFor(account), ROOT_KDF);

  it("signs a message that says nothing about the passphrase", () => {
    const commit = unlockCommit(new Uint8Array(32).fill(9));
    expect(buildRootMessage("devnet", commit)).toBe(
      `Sign this message to rebuild your UTXOpia vault.

WARNING: Only sign this in a client you trust.
Signing it anywhere else can cost you your funds.

Network: solana:devnet
Commit: ${bytesToHex(commit)}`,
    );
  });

  // Two messages, two purposes. Sharing one would let a signature gathered for
  // a device wrapping be replayed as the identity itself.
  it("is not the message a device wrapping signs", () => {
    const commit = unlockCommit(new Uint8Array(32).fill(1));
    expect(buildRootMessage("devnet", commit)).not.toBe(buildUnlockMessage("devnet"));
  });

  it("salts two members who chose the same passphrase apart", () => {
    expect(secretFor("correct horse battery staple", "did:privy:aaa")).not.toEqual(
      secretFor("correct horse battery staple", "did:privy:bbb"),
    );
  });

  it("rebuilds the same root from the same login and passphrase", async () => {
    const a = await rootFromSignature(sig(3));
    const b = await rootFromSignature(sig(3));
    expect(a).toEqual(b);
    expect(a.length).toBe(32);
  });

  // The hazard this path carries, stated as a test rather than left to be met.
  // Nothing is being decrypted, so there is no tag to fail: a wrong passphrase
  // produces a different commit, a different signature, and a different, valid,
  // empty vault. The UI has to show the member what came back before it writes.
  it("rebuilds a different root from a mistyped passphrase, silently", async () => {
    const right = unlockCommit(secretFor("correct horse battery staple", "did:privy:aaa"));
    const typo = unlockCommit(secretFor("correct horse battery stapl", "did:privy:aaa"));
    expect(right).not.toEqual(typo);
    // Different message, so a signer produces different bytes, so a different
    // root. Modelled here with distinct signatures.
    expect(await rootFromSignature(sig(1))).not.toEqual(await rootFromSignature(sig(2)));
  });
});
