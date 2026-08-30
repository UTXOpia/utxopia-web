/**
 * The two separations this design rests on, and nothing else.
 *
 * Everything in `vault-remote` is one HTTP call away from being ordinary; what
 * is not ordinary is that the row key and the PIN proof must both stay clear of
 * the argon2 salt `deriveFromPin` uses. Collapse either and our own table plus
 * a PIN sweep opens the vault without Privy — silently, and with no test
 * failing to say so. These are those tests.
 */

import { describe, expect, it } from "bun:test";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@utxopia/sdk";
import { remoteBackupSaved } from "@/lib/vault-remote";
import { remoteCredentials } from "@/lib/vault-remote";
import { deriveFromPin } from "@/lib/vault-envelope";

const scope = { networkId: "devnet", vaultId: "open" };
const ACCOUNT = "did:privy:aaa";
const sig = (fill: number) => new Uint8Array(64).fill(fill);
const PIN = "123456";

describe("vault-remote", () => {
  // The row key must stay clear of everything the key derivation touches. It
  // comes from the account now rather than a signature, so the old collision
  // with deriveFromPin's salt cannot arise — this pins that it stays gone.
  it("never publishes the argon2 salt deriveFromPin uses", () => {
    const { id } = remoteCredentials({ scope, pin: PIN, accountId: ACCOUNT });
    expect(id).not.toBe(bytesToHex(sha256(sig(7))));
  });

  it("does not put the account id anywhere a reader could recover it", () => {
    const { id, proof } = remoteCredentials({ scope, pin: PIN, accountId: ACCOUNT });
    expect(id).not.toContain(ACCOUNT);
    expect(proof).not.toContain(ACCOUNT);
  });

  it("gives two accounts different rows", () => {
    const a = remoteCredentials({ scope, pin: PIN, accountId: ACCOUNT });
    const b = remoteCredentials({ scope, pin: PIN, accountId: "did:privy:bbb" });
    expect(a.id).not.toBe(b.id);
  });

  it("proves the PIN without reproducing the wrapping key", () => {
    const { proof } = remoteCredentials({ scope, pin: PIN, accountId: ACCOUNT });
    expect(proof).not.toBe(bytesToHex(deriveFromPin(PIN, sig(7))));
  });

  it("gives Open and Verified different rows under one account", () => {
    const open = remoteCredentials({ scope, pin: PIN, accountId: ACCOUNT });
    const verified = remoteCredentials({
      scope: { networkId: "devnet", vaultId: "verified" },
      pin: PIN,
      accountId: ACCOUNT,
    });
    expect(open.id).not.toBe(verified.id);
    expect(open.proof).not.toBe(verified.proof);
  });

  it("keeps devnet and mainnet apart", () => {
    const devnet = remoteCredentials({ scope, pin: PIN, accountId: ACCOUNT });
    const mainnet = remoteCredentials({
      scope: { networkId: "mainnet", vaultId: "open" },
      pin: PIN,
      accountId: ACCOUNT,
    });
    expect(devnet.id).not.toBe(mainnet.id);
  });

  it("is reproducible — the same account and PIN find the same row", () => {
    const a = remoteCredentials({ scope, pin: PIN, accountId: ACCOUNT });
    const b = remoteCredentials({ scope, pin: PIN, accountId: ACCOUNT });
    expect(a).toEqual(b);
  });

  it("changes the proof but not the row when the PIN is wrong", () => {
    const right = remoteCredentials({ scope, pin: PIN, accountId: ACCOUNT });
    const wrong = remoteCredentials({ scope, pin: "654321", accountId: ACCOUNT });
    expect(wrong.id).toBe(right.id);
    expect(wrong.proof).not.toBe(right.proof);
  });

  it("refuses a PIN too short to be worth a lockout", () => {
    expect(() => remoteCredentials({ scope, pin: "123", accountId: ACCOUNT })).toThrow();
  });

  it("refuses to address a row with no account", () => {
    expect(() => remoteCredentials({ scope, pin: PIN, accountId: "" })).toThrow();
  });
});

/**
 * The saved-copy flag is per pool, for the same reason the row is: a member
 * with a backup for Open and none for Verified must not be told the second
 * phone will work. Scope lives in `savedKey`, and nothing else would fail if it
 * stopped.
 */
describe("remoteBackupSaved", () => {
  it("does not answer for a pool it was never set on", () => {
    localStorage.clear();
    localStorage.setItem("utxo:blob-saved:v1:devnet:open", "1");
    expect(remoteBackupSaved({ networkId: "devnet", vaultId: "open" })).toBe(true);
    expect(remoteBackupSaved({ networkId: "devnet", vaultId: "verified" })).toBe(false);
    expect(remoteBackupSaved({ networkId: "mainnet", vaultId: "open" })).toBe(false);
    localStorage.clear();
  });
});
