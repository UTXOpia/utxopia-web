/**
 * Display form of a registered receive name.
 *
 * The full name is what a sender types, so it is what the screen shows —
 * measured at 390px the identity chip has roughly 206px of text budget and
 * `milano.utxopia.sol` needs 130px, so the parent domain costs nothing worth
 * shortening for. Names past ~16 characters truncate, and truncation keeps the
 * identifying half.
 *
 * @module names/format
 */

/**
 * `milano` → `milano.utxopia.sol`. Tolerates a leading `@` because the
 * recipient field accepts that form and a value can arrive from there.
 */
export function formatSnsFullName(name: string, parentDomain: string): string {
  return `${name.replace(/^@/, "")}.${parentDomain}.sol`;
}
