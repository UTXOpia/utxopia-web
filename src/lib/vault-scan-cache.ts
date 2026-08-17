"use client";

// Decrypted-note cache, one entry per network+vault, shared by every consumer.
//
// It exists because both vaults get scanned continuously — the active one by
// the store, the other by useSiblingVaultBalances — and a vault switch used to
// throw both away: the store wiped its notes and re-scanned the vault the
// sibling hook had just finished scanning, while the hook turned around and
// re-scanned the vault the store had in memory a frame earlier. Each side
// discarded exactly what the other needed. Holding the results here lets the
// switch repaint from memory and revalidate in the background.

import type { NetworkId } from "@/lib/network-config";
import type { VaultId } from "@/lib/vault-config";
import type { InboxNote } from "@/stores/utxopia-store";

export type VaultScanStatus =
  | "unsupported" // network has no dual vaults
  | "locked" // identity not warmed this session (wallet flow / view-only)
  | "loading"
  | "ready"
  | "error";

export interface VaultScanEntry {
  status: VaultScanStatus;
  balancesByToken: Record<string, bigint>;
  notes: InboxNote[];
  /** Encoded meta address of the identity this scan belongs to. Checked before
   *  a cached scan is adopted as a balance: vault identities are separate keys,
   *  and painting one vault's notes under the other's address is a wrong
   *  balance, not a stale one. */
  owner: string;
  fetchedAt: number;
}

export const LOADING_SCAN: VaultScanEntry = {
  status: "loading",
  balancesByToken: {},
  notes: [],
  owner: "",
  fetchedAt: 0,
};

export const vaultScanKey = (networkId: NetworkId, vaultId: VaultId): string =>
  `${networkId}:${vaultId}`;

const cache = new Map<string, VaultScanEntry>();
const listeners = new Map<string, Set<() => void>>();
/** Login the cache belongs to; a different one must not read these. */
let cachedLogin: unknown = null;

export function readVaultScan(
  networkId: NetworkId,
  vaultId: VaultId,
): VaultScanEntry | undefined {
  return cache.get(vaultScanKey(networkId, vaultId));
}

export function peekVaultScan(key: string): VaultScanEntry | undefined {
  return cache.get(key);
}

export function publishVaultScan(key: string, entry: VaultScanEntry): void {
  cache.set(key, entry);
  listeners.get(key)?.forEach((notify) => notify());
}

export function subscribeVaultScan(key: string, notify: () => void): () => void {
  let set = listeners.get(key);
  if (!set) {
    set = new Set();
    listeners.set(key, set);
  }
  set.add(notify);
  return () => {
    set!.delete(notify);
    if (set!.size === 0) listeners.delete(key);
  };
}

export function hasVaultScanListeners(key: string): boolean {
  return (listeners.get(key)?.size ?? 0) > 0;
}

/**
 * Drop everything if the login changed. Identity is the root seed where there
 * is one — it outlives a vault switch (each vault derives a working identity
 * from it) and only a real sign-out replaces it, which is what makes the
 * hand-off across a switch possible at all. Sessions without a root fall back
 * to the active meta address, which does change on a switch: no hand-off
 * there, but nothing stale either.
 */
export function setScanLogin(login: unknown): void {
  if (cachedLogin === login) return;
  cachedLogin = login;
  cache.clear();
  listeners.forEach((set) => set.forEach((notify) => notify()));
}

export function isScanLogin(login: unknown): boolean {
  return cachedLogin === login;
}
