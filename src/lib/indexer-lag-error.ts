/**
 * Turn the two ways an indexer lag surfaces into something a member can act on.
 *
 * Both of these mean the same thing — our indexer has not caught up with the
 * chain yet — and neither says so:
 *
 *   Assert Failed. Error in template JoinSplit_322 line: 124
 *     `inputMerkle[i].root === merkleRoot` in joinsplit.circom. The Merkle path
 *     the client was handed does not hash to the root it was given, so no proof
 *     is ever produced. It reads like a circuit bug and is not one.
 *
 *   Note <commitment>... not found on-chain
 *     The note decrypted from the announcement feed, but its leaf is not in the
 *     tree the indexer serves, so no path can be built for it.
 *
 * Both fail *before* anything is submitted, which is the part worth telling
 * someone: nothing moved, nothing was spent, and retrying later works. Left raw,
 * a member reasonably concludes their funds are gone.
 *
 * Deliberately narrow. A catch-all that rewrote every error would eventually
 * swallow a real one, and "try again later" is bad advice for a genuine bug.
 */

import { describeProgramError } from "./program-error";

const INDEXER_LAG_PATTERNS = [
  // The circuit assert. Match the template + line rather than the whole string:
  // the template name carries a size suffix that changes with circuit params.
  /Error in template JoinSplit[_0-9]*\s*line:\s*124/i,
  /inputMerkle.*root.*!==?.*merkleRoot/i,
  /Note\s+[0-9a-fx]+\.{0,3}\s*not found on-chain/i,
  /Commitment tree account not found on-chain/i,
];

export const INDEXER_LAG_MESSAGE =
  "Our indexer is still catching up with the chain, so this transaction could not be " +
  "prepared. Nothing was submitted and nothing left your vault — your funds are exactly " +
  "where they were. Try again in a few minutes.";

export function isIndexerLagError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return INDEXER_LAG_PATTERNS.some((pattern) => pattern.test(message));
}

/**
 * The message to show a member. Returns the original for anything we do not
 * recognise — an unfamiliar error should reach them verbatim, not be smoothed
 * into a reassurance that might be false.
 */
export function humanizeSpendError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error ?? "");
  // Lag first: an indexer that is behind produces a *proof* failure, which the
  // program never sees, so the two cases cannot both match.
  if (isIndexerLagError(message)) return INDEXER_LAG_MESSAGE;
  return describeProgramError(message) ?? (message || "Transaction failed");
}
