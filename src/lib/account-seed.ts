/**
 * Account-index scoping for a passkey identity seed.
 *
 * One passkey → one root → many independent accounts. Each index derives a
 * separate spend/nullify/view key set, so accounts share no linkage and can be
 * disclosed independently (see the delegated view keys in the SDK's auditor).
 *
 * Index 0 returns the seed untouched — every identity that exists today lives
 * there, and moving it would strand every note already in the tree.
 */
const ACCOUNT_DOMAIN = "utxopia:account:v1";

export async function accountScopedSeed(
  seed: Uint8Array,
  accountIndex: number,
): Promise<Uint8Array> {
  if (!Number.isInteger(accountIndex) || accountIndex < 0) {
    throw new Error(`Invalid account index: ${accountIndex}`);
  }
  if (accountIndex === 0) return seed;

  const domain = new TextEncoder().encode(`${ACCOUNT_DOMAIN}:${accountIndex}`);
  const material = new Uint8Array(seed.length + domain.length);
  material.set(seed);
  material.set(domain, seed.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", material));
}
