"use client";

/**
 * Client-side memory of the SuiNS name a login already claimed.
 *
 * The subname NFT is held by the sponsor and only the user's suiAddress is set as
 * the name's target, so there is no "owned object" to reverse-look-up and the
 * server claims ledger is ephemeral on Vercel. Persisting the claimed name here
 * (keyed by the stable suiAddress) lets the panel show it on re-login instead of
 * the claim bar. On-chain resolution still confirms the target before display.
 */

const KEY_PREFIX = "utxo:suins:claimed:";

function key(suiAddress: string): string {
  return KEY_PREFIX + suiAddress.trim().toLowerCase();
}

export function getClaimedSuiNsName(suiAddress: string | null | undefined): string | null {
  if (!suiAddress) return null;
  try {
    return localStorage.getItem(key(suiAddress));
  } catch {
    return null;
  }
}

export function setClaimedSuiNsName(suiAddress: string, normalizedName: string): void {
  try {
    localStorage.setItem(key(suiAddress), normalizedName);
  } catch {
    // localStorage unavailable — non-fatal; the ledger GET fallback still applies.
  }
}
