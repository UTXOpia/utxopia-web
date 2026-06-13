import { describe, it, expect } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { deriveNameOwnerKeypair, NAME_OWNER_HKDF_LABEL } from "./passkey-solana-key";

const SEED = new Uint8Array(32).fill(7); // fixed test seed

describe("deriveNameOwnerKeypair", () => {
  it("is deterministic for the same seed", () => {
    const a = deriveNameOwnerKeypair(SEED);
    const b = deriveNameOwnerKeypair(SEED);
    expect(a.publicKey.toBase58()).toBe(b.publicKey.toBase58());
  });
  it("is a valid Solana keypair", () => {
    const kp = deriveNameOwnerKeypair(SEED);
    expect(kp).toBeInstanceOf(Keypair);
    expect(kp.publicKey.toBytes()).toHaveLength(32);
  });
  it("is domain-separated from the raw seed (not Keypair.fromSeed(seed))", () => {
    const derived = deriveNameOwnerKeypair(SEED).publicKey.toBase58();
    const naive = Keypair.fromSeed(SEED).publicKey.toBase58();
    expect(derived).not.toBe(naive);
  });
  it("uses the frozen v1 label", () => {
    expect(NAME_OWNER_HKDF_LABEL).toBe("utxopia:solana-name-owner:v1");
  });
  // FROZEN TEST VECTOR — if this fails, the derivation changed and would orphan
  // every registered name. Do NOT update without a deliberate v2 migration.
  it("matches the frozen test vector", () => {
    expect(deriveNameOwnerKeypair(SEED).publicKey.toBase58()).toBe(
      "49wDohCsu9armqGMX6NXMbz9xHdCdDXyAGStWZNXJMKW",
    );
  });
});
