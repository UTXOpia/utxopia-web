import { beforeEach, describe, expect, it } from "bun:test";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@utxopia/sdk";
import {
  EnvelopeIdentityError,
  SignerChangedError,
  workingSeedFor,
  NoDeviceEnvelopeError,
  VaultAlreadyHereError,
  WeakPassphraseError,
  adoptExistingSeed,
  armDevice,
  buildRecoveryString,
  changePassphrase,
  clearDeviceEnvelope,
  createVault,
  hasDeviceEnvelope,
  assertDeviceSigner,
  readDeviceEnvelope,
  readDeviceSigner,
  unlockWithDevice,
  writeDeviceSigner,
  unlockWithRecoveryString,
  verifyRecoveryString,
} from "./vault-identity";
import { MIN_PIN_LENGTH, WeakPinError, deriveFromPin } from "./vault-envelope";
import { EnvelopeUnlockError } from "./vault-envelope";

// A stand-in for the SDK's seed → meta-address derivation: deterministic, and
// different seeds must land on different addresses.
const metaAddressFor = async (seed: Uint8Array) => `utxo:${bytesToHex(sha256(seed)).slice(0, 24)}`;

const SCOPE = { networkId: "solana:devnet", vaultId: "verified" };
const OTHER_SCOPE = { networkId: "solana:devnet", vaultId: "open" };
const PASSPHRASE = "brief candle dusk arch";
const device = (byte: number) => new Uint8Array(32).fill(byte);

/** A browser that has never seen this vault. */
const freshBrowser = () => localStorage.clear();

beforeEach(freshBrowser);

describe("creating a vault", () => {
  it("arms the device and hands back a recovery string the member must keep", async () => {
    const created = await createVault({
      scope: SCOPE,
      passphrase: PASSPHRASE,
      deviceKeyMaterial: device(1),
      metaAddressFor,
    });
    expect(created.recoveryString.startsWith("utxovault1")).toBe(true);
    expect(hasDeviceEnvelope(SCOPE)).toBe(true);
    // The address comes from the scope's working seed, not the root the member
    // keeps — that is what gives the guard something of its own to check.
    expect(created.metaAddress).toBe(await metaAddressFor(await workingSeedFor(created.seed, SCOPE)));
    expect(created.metaAddress).not.toBe(await metaAddressFor(created.seed));
  });

  it("never stores the recovery string", async () => {
    const created = await createVault({
      scope: SCOPE,
      passphrase: PASSPHRASE,
      deviceKeyMaterial: device(1),
      metaAddressFor,
    });
    const stored = [...Array(localStorage.length).keys()].map((i) =>
      localStorage.getItem(localStorage.key(i)!),
    );
    expect(stored.some((v) => v?.includes(created.recoveryString))).toBe(false);
  });

  it("gives every vault its own identity from one root", async () => {
    const a = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    const b = await createVault({ scope: OTHER_SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    expect(a.metaAddress).not.toBe(b.metaAddress);
    expect(readDeviceEnvelope(SCOPE)).not.toEqual(readDeviceEnvelope(OTHER_SCOPE)!);
  });

  it("refuses a passphrase too short to be the only lock on the string", async () => {
    await expect(
      createVault({ scope: SCOPE, passphrase: "hunter2", deviceKeyMaterial: device(1), metaAddressFor }),
    ).rejects.toBeInstanceOf(WeakPassphraseError);
  });
});

describe("daily unlock", () => {
  it("returns the same identity it was created with", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    const unlocked = await unlockWithDevice({ scope: SCOPE, deviceKeyMaterial: device(1), metaAddressFor });
    expect(unlocked.seed).toEqual(created.seed);
    expect(unlocked.metaAddress).toBe(created.metaAddress);
  });

  it("refuses a different passkey rather than inventing an identity", async () => {
    await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    await expect(
      unlockWithDevice({ scope: SCOPE, deviceKeyMaterial: device(2), metaAddressFor }),
    ).rejects.toBeInstanceOf(EnvelopeUnlockError);
  });

  it("says so when this browser has no vault, instead of making one", async () => {
    await expect(
      unlockWithDevice({ scope: SCOPE, deviceKeyMaterial: device(1), metaAddressFor }),
    ).rejects.toBeInstanceOf(NoDeviceEnvelopeError);
  });

  it("does not leak one vault's wrapping into the other", async () => {
    await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    await expect(
      unlockWithDevice({ scope: OTHER_SCOPE, deviceKeyMaterial: device(1), metaAddressFor }),
    ).rejects.toBeInstanceOf(NoDeviceEnvelopeError);
  });
});

describe("restoring on a new device", () => {
  it("recovers the identity from string plus passphrase alone", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    freshBrowser();

    const restored = await unlockWithRecoveryString({
      scope: SCOPE,
      recoveryString: created.recoveryString,
      passphrase: PASSPHRASE,
      deviceKeyMaterial: device(7),
      metaAddressFor,
    });
    expect(restored.seed).toEqual(created.seed);
    expect(hasDeviceEnvelope(SCOPE)).toBe(true);
  });

  it("arms the new device so the passphrase is typed once, not every session", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    freshBrowser();
    await unlockWithRecoveryString({
      scope: SCOPE,
      recoveryString: created.recoveryString,
      passphrase: PASSPHRASE,
      deviceKeyMaterial: device(7),
      metaAddressFor,
    });
    const daily = await unlockWithDevice({ scope: SCOPE, deviceKeyMaterial: device(7), metaAddressFor });
    expect(daily.seed).toEqual(created.seed);
  });

  it("rejects the wrong passphrase instead of opening an empty stranger", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    await expect(
      unlockWithRecoveryString({
        scope: SCOPE,
        recoveryString: created.recoveryString,
        passphrase: "brief candle dusk arch!",
        metaAddressFor,
      }),
    ).rejects.toBeInstanceOf(EnvelopeUnlockError);
  });

  it("leaves the device unarmed when the restore fails", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    freshBrowser();
    await expect(
      unlockWithRecoveryString({
        scope: SCOPE,
        recoveryString: created.recoveryString,
        passphrase: "wrong wrong wrong",
        deviceKeyMaterial: device(7),
        metaAddressFor,
      }),
    ).rejects.toBeInstanceOf(EnvelopeUnlockError);
    expect(hasDeviceEnvelope(SCOPE)).toBe(false);
  });

  // The finding this exists for: a genuine string from the member's other pool
  // used to decrypt cleanly here and overwrite this pool's wrapping. Scope is
  // bound into the AEAD now, so it fails at the tag before anything is touched.
  it("refuses a genuine string from the member's other vault", async () => {
    const other = await createVault({
      scope: OTHER_SCOPE,
      passphrase: PASSPHRASE,
      deviceKeyMaterial: device(1),
      metaAddressFor,
    });
    await expect(
      unlockWithRecoveryString({
        scope: SCOPE,
        recoveryString: other.recoveryString,
        passphrase: PASSPHRASE,
        deviceKeyMaterial: device(1),
        metaAddressFor,
      }),
    ).rejects.toBeInstanceOf(EnvelopeUnlockError);
    // and crucially left this scope's wrapping alone
    expect(hasDeviceEnvelope(SCOPE)).toBe(false);
  });

  it("still stops a fabricated envelope whose guard names another vault", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    const misleading = await buildRecoveryString({
      scope: SCOPE,
      seed: created.seed,
      passphrase: PASSPHRASE,
      metaAddress: "utxo:somebodyelse",
    });
    freshBrowser();
    await expect(
      unlockWithRecoveryString({
        scope: SCOPE,
        recoveryString: misleading,
        passphrase: PASSPHRASE,
        metaAddressFor,
      }),
    ).rejects.toBeInstanceOf(EnvelopeIdentityError);
  });

  it("refuses to create over a vault this browser already holds", async () => {
    await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    await expect(
      createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor }),
    ).rejects.toBeInstanceOf(VaultAlreadyHereError);
  });
});

describe("proving a new string opens", () => {
  it("passes for the passphrase it was built with", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    await expect(
      verifyRecoveryString({
        scope: SCOPE,
        recoveryString: created.recoveryString,
        passphrase: PASSPHRASE,
        metaAddress: created.metaAddress,
      }),
    ).resolves.toBeUndefined();
  });

  // The whole point: a typo at creation is otherwise invisible until a restore
  // months later, with no old device left.
  it("catches a typo the member would not discover for months", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    await expect(
      verifyRecoveryString({
        scope: SCOPE,
        recoveryString: created.recoveryString,
        passphrase: `${PASSPHRASE} `.replace("arch ", "arcg "),
        metaAddress: created.metaAddress,
      }),
    ).rejects.toBeInstanceOf(EnvelopeUnlockError);
  });

  it("leaves nothing behind — it is a check, not an unlock", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    const before = readDeviceEnvelope(SCOPE);
    await verifyRecoveryString({
      scope: SCOPE,
      recoveryString: created.recoveryString,
      passphrase: PASSPHRASE,
      metaAddress: created.metaAddress,
    });
    expect(readDeviceEnvelope(SCOPE)).toEqual(before!);
  });
});

describe("changing the passphrase", () => {
  it("keeps the identity", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    const next = await changePassphrase({
      scope: SCOPE,
      seed: created.seed,
      metaAddress: created.metaAddress,
      nextPassphrase: "another long passphrase",
    });
    const restored = await unlockWithRecoveryString({
      scope: SCOPE,
      recoveryString: next,
      passphrase: "another long passphrase",
      metaAddressFor,
    });
    expect(restored.metaAddress).toBe(created.metaAddress);
  });

  // The member has to be told this: a string already written down cannot be
  // revoked, and only rotating the seed actually retires it.
  it("does not invalidate a string that is already out there", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    await changePassphrase({
      scope: SCOPE,
      seed: created.seed,
      metaAddress: created.metaAddress,
      nextPassphrase: "another long passphrase",
    });
    const stillWorks = await unlockWithRecoveryString({
      scope: SCOPE,
      recoveryString: created.recoveryString,
      passphrase: PASSPHRASE,
      metaAddressFor,
    });
    expect(stillWorks.seed).toEqual(created.seed);
  });

  it("refuses a weak replacement", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    await expect(
      changePassphrase({ scope: SCOPE, seed: created.seed, metaAddress: created.metaAddress, nextPassphrase: "short" }),
    ).rejects.toBeInstanceOf(WeakPassphraseError);
  });
});

describe("adopting an identity that predates envelopes", () => {
  it("wraps the existing seed without moving anything", async () => {
    const existing = new Uint8Array(32).fill(42);
    const adopted = await adoptExistingSeed({
      scope: SCOPE,
      seed: existing,
      passphrase: PASSPHRASE,
      deviceKeyMaterial: device(3),
      metaAddressFor,
    });
    expect(adopted.metaAddress).toBe(await metaAddressFor(await workingSeedFor(existing, SCOPE)));

    const unlocked = await unlockWithDevice({ scope: SCOPE, deviceKeyMaterial: device(3), metaAddressFor });
    expect(unlocked.seed).toEqual(existing);
  });
});

describe("logging out", () => {
  it("removes this device's wrapping and only this vault's", async () => {
    await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    await createVault({ scope: OTHER_SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    clearDeviceEnvelope(SCOPE);
    expect(hasDeviceEnvelope(SCOPE)).toBe(false);
    expect(hasDeviceEnvelope(OTHER_SCOPE)).toBe(true);
  });
});

describe("armDevice", () => {
  it("rewraps with a fresh salt each time", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    const first = readDeviceEnvelope(SCOPE)!;
    await armDevice({ scope: SCOPE, seed: created.seed, metaAddress: created.metaAddress, deviceKeyMaterial: device(1) });
    const second = readDeviceEnvelope(SCOPE)!;
    expect(second.kdf.salt).not.toEqual(first.kdf.salt);
    expect(second.nonce).not.toEqual(first.nonce);
  });
});

describe("a PIN is not a passphrase", () => {
  beforeEach(freshBrowser);

  // The two share no code path by construction, and the length floors make the
  // separation impossible to cross by accident: a PIN short enough to be worth
  // typing daily cannot reach a recovery string, which is the only factor here
  // carrying real entropy.
  it("is too short to lock a recovery string", async () => {
    const pin = "1".repeat(MIN_PIN_LENGTH);
    expect(
      createVault({ scope: SCOPE, passphrase: pin, metaAddressFor }),
    ).rejects.toThrow(WeakPassphraseError);
  });

  it("refuses to stretch something shorter than a PIN either", () => {
    expect(() => deriveFromPin("12345", new Uint8Array(64).fill(1))).toThrow(WeakPinError);
  });
});

describe("the login that armed this device", () => {
  beforeEach(freshBrowser);

  it("passes when it is the one that armed, or when nothing armed yet", () => {
    expect(() => assertDeviceSigner(SCOPE, "wallet-a")).not.toThrow();
    writeDeviceSigner(SCOPE, "wallet-a");
    expect(() => assertDeviceSigner(SCOPE, "wallet-a")).not.toThrow();
  });

  // Without this the member is told their passkey stopped working, on a screen
  // with no passkey involved and nothing to act on.
  it("names itself when the provider hands back a different wallet", () => {
    writeDeviceSigner(SCOPE, "wallet-a");
    expect(() => assertDeviceSigner(SCOPE, "wallet-b")).toThrow(SignerChangedError);
  });

  it("is scoped per pool, like the wrapping it describes", () => {
    writeDeviceSigner(SCOPE, "wallet-a");
    expect(readDeviceSigner(OTHER_SCOPE)).toBeNull();
    expect(() => assertDeviceSigner(OTHER_SCOPE, "wallet-b")).not.toThrow();
  });

  it("is forgotten with the vault, not left behind to mislead the next one", async () => {
    await createVault({
      scope: SCOPE,
      passphrase: PASSPHRASE,
      deviceKeyMaterial: device(1),
      metaAddressFor,
    });
    writeDeviceSigner(SCOPE, "wallet-a");
    clearDeviceEnvelope(SCOPE);
    expect(readDeviceSigner(SCOPE)).toBeNull();
  });
});

describe("a wrong factor cannot open a different vault", () => {
  beforeEach(freshBrowser);

  // The property the whole envelope design exists for. A derived identity would
  // hand a wrong PIN a valid, empty vault and report nothing; an unwrapped one
  // fails the AEAD tag, which is an error somebody can act on.
  it("fails loudly instead of producing a second identity", async () => {
    await createVault({
      scope: SCOPE,
      passphrase: PASSPHRASE,
      deviceKeyMaterial: device(1),
      metaAddressFor,
    });

    expect(
      unlockWithDevice({ scope: SCOPE, deviceKeyMaterial: device(2), metaAddressFor }),
    ).rejects.toThrow(EnvelopeUnlockError);
  });

  // Same failure, two factors, and only one of them has a field on screen to
  // correct. Sending a mistyped PIN to the recovery string is telling somebody
  // to use the nuclear option over a typo.
  it("names the factor the member actually used", async () => {
    await createVault({
      scope: SCOPE,
      passphrase: PASSPHRASE,
      deviceKeyMaterial: device(1),
      metaAddressFor,
    });

    const pin = await unlockWithDevice({
      scope: SCOPE,
      deviceKeyMaterial: device(2),
      metaAddressFor,
      factor: "pin",
    }).catch((caught: Error) => caught.message);
    expect(pin).toContain("PIN");
    expect(pin).not.toContain("recovery string");

    const passkey = await unlockWithDevice({
      scope: SCOPE,
      deviceKeyMaterial: device(2),
      metaAddressFor,
    }).catch((caught: Error) => caught.message);
    expect(passkey).toContain("passkey");
    expect(passkey).toContain("recovery string");
  });
});
