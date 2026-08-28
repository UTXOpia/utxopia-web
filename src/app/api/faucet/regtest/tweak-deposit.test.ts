import { describe, expect, test } from "bun:test";
import {
  deriveDepositAddress,
  depositTweakCommitment,
  bytesToHex,
} from "@utxopia/sdk";

const vaultKey = new Uint8Array(32).fill(0x33);
const npk = new Uint8Array(32).fill(0x22);
const eph = new Uint8Array(32).fill(0x11);

/**
 * The faucet route cannot derive a tweak deposit address: that needs the
 * recipient's viewing PRIVATE key, and a stealth meta-address carries only
 * `viewingPubKey`. It validates a client-derived one instead, which needs no
 * secret — recompute from the public keys and compare.
 *
 * These assert the property the route's check depends on. If recomputing from
 * public inputs ever stopped being possible, the route would have to either
 * trust the client or derive a random ephemeral key, and a random one burns the
 * coins: the address commits to it and the key path is a NUMS point.
 */
describe("faucet tweak deposit validation", () => {
  test("an address is recomputable from public keys alone", () => {
    const derived = deriveDepositAddress(
      depositTweakCommitment(npk, eph),
      vaultKey,
      "regtest",
    ).address;

    // Same inputs, same answer — no secret involved.
    expect(deriveDepositAddress(depositTweakCommitment(npk, eph), vaultKey, "regtest").address)
      .toBe(derived);
    expect(derived).toBe("bcrt1pl44ykzegsumc3vgmghv0m7qerrvzcwds2qmfqerhj85jy9dl3dvs084mpx");
  });

  test("a substituted key derives a different address, so the check catches it", () => {
    const honest = deriveDepositAddress(
      depositTweakCommitment(npk, eph),
      vaultKey,
      "regtest",
    ).address;

    const forgedEph = new Uint8Array(eph);
    forgedEph[0] ^= 1;
    const forgedNpk = new Uint8Array(npk);
    forgedNpk[0] ^= 1;

    for (const bad of [
      depositTweakCommitment(npk, forgedEph),
      depositTweakCommitment(forgedNpk, eph),
    ]) {
      expect(deriveDepositAddress(bad, vaultKey, "regtest").address).not.toBe(honest);
    }

    // And another pool's custody key must not produce this pool's address.
    expect(
      deriveDepositAddress(
        depositTweakCommitment(npk, eph),
        new Uint8Array(32).fill(0x34),
        "regtest",
      ).address,
    ).not.toBe(honest);
  });

  test("the keys the route forwards are the ones the address commits to", () => {
    // The route registers note_public_key / ephemeral_pubkey with the tracker,
    // which later hands them to the program as instruction data. If they were not
    // the pair the address was derived from, the on-chain leaf check would fail
    // and the deposit could never be credited.
    const commitment = depositTweakCommitment(npk, eph);
    expect(bytesToHex(commitment)).toBe(
      "adfafc05aac733fe9509f43bd1d158c882890351c7f343634c8ef9ea42cdb505",
    );
    expect(deriveDepositAddress(commitment, vaultKey, "regtest").leafScript.length).toBe(68);
  });
});
