import { beforeEach, describe, expect, it } from "bun:test";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@utxopia/sdk";
import {
  EnvelopeIdentityError,
  NoDeviceEnvelopeError,
  WeakPassphraseError,
  adoptExistingSeed,
  armDevice,
  buildRecoveryString,
  changePassphrase,
  clearDeviceEnvelope,
  createVault,
  hasDeviceEnvelope,
  readDeviceEnvelope,
  unlockWithDevice,
  unlockWithRecoveryString,
} from "./vault-identity";
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
    expect(created.metaAddress).toBe(await metaAddressFor(created.seed));
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

  it("gives every vault its own seed", async () => {
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

  it("stops a correct passphrase against another vault's string", async () => {
    const other = await createVault({ scope: OTHER_SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    // Same seed, but the guard was written for a different meta-address.
    const misleading = await buildRecoveryString({
      seed: other.seed,
      passphrase: PASSPHRASE,
      metaAddress: "utxo:somebodyelse",
    });
    await expect(
      unlockWithRecoveryString({
        scope: SCOPE,
        recoveryString: misleading,
        passphrase: PASSPHRASE,
        metaAddressFor,
      }),
    ).rejects.toBeInstanceOf(EnvelopeIdentityError);
  });
});

describe("changing the passphrase", () => {
  it("keeps the identity", async () => {
    const created = await createVault({ scope: SCOPE, passphrase: PASSPHRASE, deviceKeyMaterial: device(1), metaAddressFor });
    const next = await changePassphrase({
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
      changePassphrase({ seed: created.seed, metaAddress: created.metaAddress, nextPassphrase: "short" }),
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
    expect(adopted.metaAddress).toBe(await metaAddressFor(existing));

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
