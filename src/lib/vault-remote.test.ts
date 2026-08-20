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
import { remoteCredentials } from "@/lib/vault-remote";
import { deriveFromPin } from "@/lib/vault-envelope";

const scope = { networkId: "devnet", vaultId: "open" };
const sig = (fill: number) => new Uint8Array(64).fill(fill);
const PIN = "123456";

describe("vault-remote", () => {
  it("never publishes the argon2 salt deriveFromPin uses", () => {
    const { id } = remoteCredentials({ scope, pin: PIN, signature: sig(7) });
    expect(id).not.toBe(bytesToHex(sha256(sig(7))));
  });

  it("proves the PIN without reproducing the wrapping key", () => {
    const { proof } = remoteCredentials({ scope, pin: PIN, signature: sig(7) });
    expect(proof).not.toBe(bytesToHex(deriveFromPin(PIN, sig(7))));
  });

  it("gives Open and Verified different rows under one signature", () => {
    const open = remoteCredentials({ scope, pin: PIN, signature: sig(7) });
    const verified = remoteCredentials({
      scope: { networkId: "devnet", vaultId: "verified" },
      pin: PIN,
      signature: sig(7),
    });
    expect(open.id).not.toBe(verified.id);
    expect(open.proof).not.toBe(verified.proof);
  });

  it("keeps devnet and mainnet apart", () => {
    const devnet = remoteCredentials({ scope, pin: PIN, signature: sig(7) });
    const mainnet = remoteCredentials({
      scope: { networkId: "mainnet", vaultId: "open" },
      pin: PIN,
      signature: sig(7),
    });
    expect(devnet.id).not.toBe(mainnet.id);
  });

  it("is reproducible — the same login and PIN find the same row", () => {
    const a = remoteCredentials({ scope, pin: PIN, signature: sig(7) });
    const b = remoteCredentials({ scope, pin: PIN, signature: sig(7) });
    expect(a).toEqual(b);
  });

  it("changes the proof but not the row when the PIN is wrong", () => {
    const right = remoteCredentials({ scope, pin: PIN, signature: sig(7) });
    const wrong = remoteCredentials({ scope, pin: "654321", signature: sig(7) });
    expect(wrong.id).toBe(right.id);
    expect(wrong.proof).not.toBe(right.proof);
  });

  it("refuses a PIN too short to be worth a lockout", () => {
    expect(() => remoteCredentials({ scope, pin: "123", signature: sig(7) })).toThrow();
  });
});
