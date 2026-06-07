/**
 * Hex encoding helpers shared across the web app.
 */

/**
 * Format a field element / token id / commitment as a zero-padded 64-char
 * (32-byte) lowercase hex string — the on-chain canonical width.
 *
 * Accepts a bigint, number, or numeric string (decimal or 0x-prefixed).
 */
export function toHex64(value: bigint | number | string): string {
  return BigInt(value).toString(16).padStart(64, "0");
}
