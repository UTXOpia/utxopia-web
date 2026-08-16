/**
 * Display forms of a registered receive name.
 *
 * Every name lives under one parent domain, so repeating it on screen spends
 * most of the width on the part that never varies — and truncation then eats
 * the only part that identifies anyone. The handle form keeps the identity.
 *
 * `@name` is not a new notation: `normalizeSnsSubdomain` already strips a
 * leading `@`, and the recipient field has always accepted it, so a handle
 * shown here can be typed straight back in.
 *
 * @module names/format
 */

/** `milano` → `@milano`. For showing who someone is. */
export function formatSnsHandle(name: string): string {
  return `@${name.replace(/^@/, "")}`;
}

/**
 * `milano` → `milano.utxopia.sol`. The canonical name, which resolves in any
 * SNS-aware client rather than only where the `@` shorthand is understood —
 * so this is what gets copied, whatever the screen shows.
 */
export function formatSnsFullName(name: string, parentDomain: string): string {
  return `${name.replace(/^@/, "")}.${parentDomain}.sol`;
}
