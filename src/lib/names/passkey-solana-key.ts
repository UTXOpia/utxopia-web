import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha2";
import { Keypair } from "@solana/web3.js";

/** FROZEN domain separator. Distinct from any ZK-key label so the name-owner key
 *  is cryptographically independent from the fund-controlling keys. A change
 *  re-derives every name owner and orphans registered names — bump to v2 only as
 *  a deliberate, migrated break. */
export const NAME_OWNER_HKDF_LABEL = "utxopia:solana-name-owner:v1";

/** Derive a dedicated, non-fund Solana keypair from the 32-byte passkey seed.
 *  HKDF-SHA256 (RFC 5869) for domain separation + ed25519 seed→keypair
 *  (Keypair.fromSeed). No custom crypto. */
export function deriveNameOwnerKeypair(passkeySeed: Uint8Array): Keypair {
  if (passkeySeed.length !== 32) {
    throw new Error("passkey seed must be 32 bytes");
  }
  const ed25519Seed = hkdf(
    sha256,
    passkeySeed,
    new Uint8Array(0),
    new TextEncoder().encode(NAME_OWNER_HKDF_LABEL),
    32,
  );
  return Keypair.fromSeed(ed25519Seed);
}
