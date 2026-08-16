import { describe, expect, it } from "bun:test";
import {
  EnvelopeIdentityError,
  EnvelopeUnlockError,
  KDF_V1,
  assertIdentity,
  buildUnlockMessage,
  deriveSecret,
  newSalt,
  newSeed,
  unwrapSeed,
  wrapSeed,
} from "./vault-envelope";

const sig = (byte: number) => new Uint8Array(64).fill(byte);

describe("vault envelope", () => {
  it("round-trips a seed", async () => {
    const seed = newSeed();
    const envelope = await wrapSeed({ seed, signature: sig(1), salt: newSalt() });
    expect(await unwrapSeed(envelope, sig(1))).toEqual(seed);
  });

  it("fails loudly on the wrong unlock key instead of yielding a stranger's seed", async () => {
    const envelope = await wrapSeed({ seed: newSeed(), signature: sig(1), salt: newSalt() });
    await expect(unwrapSeed(envelope, sig(2))).rejects.toBeInstanceOf(EnvelopeUnlockError);
  });

  it("rejects a tampered ciphertext", async () => {
    const envelope = await wrapSeed({ seed: newSeed(), signature: sig(1), salt: newSalt() });
    const flipped = { ...envelope, ct: envelope.ct.replace(/^./, (c) => (c === "a" ? "b" : "a")) };
    await expect(unwrapSeed(flipped, sig(1))).rejects.toBeInstanceOf(EnvelopeUnlockError);
  });

  it("re-wraps the same seed under a new key — changing a passphrase keeps the identity", async () => {
    const seed = newSeed();
    const first = await wrapSeed({ seed, signature: sig(1), salt: newSalt() });
    const rewrapped = await wrapSeed({
      seed: await unwrapSeed(first, sig(1)),
      signature: sig(9),
      salt: newSalt(),
    });
    expect(await unwrapSeed(rewrapped, sig(9))).toEqual(seed);
    await expect(unwrapSeed(rewrapped, sig(1))).rejects.toBeInstanceOf(EnvelopeUnlockError);
  });

  it("carries its kdf parameters so they can be raised later", async () => {
    const envelope = await wrapSeed({ seed: newSeed(), signature: sig(1), salt: newSalt() });
    expect(envelope.kdf.m).toBe(KDF_V1.m);
    expect(envelope.kdf.t).toBe(KDF_V1.t);
    expect(envelope.kdf.salt).toHaveLength(32);
  });

  it("stops an unlock that lands on a different identity", async () => {
    const envelope = await wrapSeed({
      seed: newSeed(),
      signature: sig(1),
      salt: newSalt(),
      guard: "utxo:aaaa",
    });
    expect(() => assertIdentity(envelope, "utxo:aaaa")).not.toThrow();
    expect(() => assertIdentity(envelope, "utxo:bbbb")).toThrow(EnvelopeIdentityError);
  });
});

describe("unlock message", () => {
  // The template is the account. If this test needs updating, every existing
  // member has been locked out of their envelope.
  it("is frozen", () => {
    const message = buildUnlockMessage({
      network: "solana:devnet",
      vault: "verified",
      secret: new Uint8Array(32).fill(0xab),
    });
    expect(message).toBe(
      `Sign this message to unlock your UTXOpia vault.

WARNING: Only sign this in a client you trust.
Signing it anywhere else can cost you your funds.

Network: solana:devnet
Vault: verified
Secret: ${"ab".repeat(32)}`,
    );
  });

  it("scopes the message per network and vault", () => {
    const base = { secret: new Uint8Array(32) };
    const open = buildUnlockMessage({ ...base, network: "solana:mainnet", vault: "open" });
    const verified = buildUnlockMessage({ ...base, network: "solana:mainnet", vault: "verified" });
    expect(open).not.toBe(verified);
  });
});

describe("passphrase stretching", () => {
  it("is deterministic for the same passphrase and salt", () => {
    const salt = newSalt();
    expect(deriveSecret("correct horse battery staple", salt)).toEqual(
      deriveSecret("correct horse battery staple", salt),
    );
  });

  it("separates members who picked the same passphrase", () => {
    expect(deriveSecret("hunter2", newSalt())).not.toEqual(deriveSecret("hunter2", newSalt()));
  });

  it("costs enough to be worth having but stays usable on a phone", () => {
    const started = performance.now();
    deriveSecret("correct horse battery staple", newSalt());
    const elapsed = performance.now() - started;
    // Brute force is what this buys; a restore that feels broken is what it
    // must not cost. Both bounds are load-bearing.
    expect(elapsed).toBeGreaterThan(20);
    expect(elapsed).toBeLessThan(4000);
  });
});
