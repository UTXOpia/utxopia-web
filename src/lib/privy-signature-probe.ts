/**
 * Watch Privy's signatures for the one property the login wrapping rests on.
 *
 * Ed25519 is deterministic by RFC 8032 and Solana signs that way, so the same
 * wallet over the same message must reproduce the same bytes. That is an
 * assumption about a vendor's pipeline, not about the algorithm: a re-encoded
 * message, a swapped signing backend, or a move to threshold signing — where
 * the nonce is generated jointly from fresh randomness — all break it silently.
 *
 * Silently is the problem. Nothing errors; every member's wrapping simply stops
 * opening, and the vault behind it reads as empty. So the first signature of a
 * given message is recorded and every later one is compared, which costs no
 * extra prompt because it rides on signatures the app was making anyway.
 *
 * Development only. It writes to localStorage and shouts in the console, and a
 * member has no use for either.
 */

import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@utxopia/sdk";

const PREFIX = "utxo:dev:sigprobe:";

const digest = (bytes: Uint8Array) => bytesToHex(sha256(bytes));

export function probeEnabled(): boolean {
  return process.env.NODE_ENV !== "production" && typeof window !== "undefined";
}

/**
 * Record or check this signature. Returns null when it agreed with what this
 * browser saw before, or a description of the drift when it did not.
 */
export function checkSignatureStability(input: {
  signer: string;
  message: Uint8Array;
  signature: Uint8Array;
}): string | null {
  if (!probeEnabled()) return null;

  const key = `${PREFIX}${input.signer}:${digest(input.message).slice(0, 16)}`;
  const seen = digest(input.signature);
  let previous: string | null = null;
  try {
    previous = localStorage.getItem(key);
    if (previous === null) localStorage.setItem(key, seen);
  } catch {
    return null; // No storage to compare against is not a finding.
  }

  if (previous === null || previous === seen) return null;
  return (
    `[privy] the same wallet signed the same message differently — ${previous.slice(0, 16)}` +
    ` then ${seen.slice(0, 16)}. Every login wrapping written before now has stopped opening,` +
    ` and the vaults behind them will read as empty rather than as an error.` +
    ` Check the SDK version and whether the signing backend changed.`
  );
}
