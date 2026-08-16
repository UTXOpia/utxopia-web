"use client";

// Read-only balance view of the OTHER vault (open ↔ verified) so the wallet
// can show both in one list. Uses the sibling identity warmed into the
// in-session key cache during the passkey unlock ceremony — never prompts.
// The two vaults stay fully separate on-chain; this is aggregation-at-display.

import { useCallback, useEffect, useRef, useState } from "react";
import {
  scanUnifiedNotes,
  computeNullifierHashForNote,
  createStealthMetaAddress,
  encodeStealthMetaAddress,
  UTXOpiaClient,
  type ScannedNote,
} from "@utxopia/sdk";
import { useChainEnvironment, type ChainEnvironment } from "@/lib/chain-environment";
import { getNetworkConfig, type NetworkId } from "@/lib/network-config";
import {
  getVaultNetworkConfig,
  siblingVaultId,
  vaultsSupported,
  type VaultId,
} from "@/lib/vault-config";
import { fetchInboxSource } from "@/lib/chain-inbox";
import { fetchSpentNullifierPDAs, nullifierHashToPDA } from "@/lib/nullifier-utils";
import { VAULT_TOKENS } from "@/lib/supported-tokens";
import { loadWarmVaultKeys, useUTXOpiaStore, type InboxNote } from "@/stores/utxopia-store";

export type SiblingVaultStatus =
  | "unsupported" // network has no dual vaults
  | "locked" // sibling identity not warmed this session (wallet flow / view-only)
  | "loading"
  | "ready"
  | "error";

export interface SiblingVaultBalances {
  status: SiblingVaultStatus;
  vaultId: VaultId;
  balancesByToken: Record<string, bigint>;
  /** Decrypted sibling-vault notes (spent + unspent), InboxNote-shaped for reuse in activity views. */
  notes: InboxNote[];
  refresh: () => void;
}

const REFRESH_INTERVAL_MS = 60_000;

/** Sum unspent note amounts per token symbol. Exported for tests. */
export function sumUnspentByToken(
  notes: Array<{ tokenSymbol: string; amount: bigint | number; isSpent: boolean }>,
): Record<string, bigint> {
  const balances: Record<string, bigint> = {};
  for (const note of notes) {
    if (note.isSpent) continue;
    balances[note.tokenSymbol] =
      (balances[note.tokenSymbol] ?? 0n) + BigInt(note.amount ?? 0);
  }
  return balances;
}

/** Scan targets for the sibling vault. The shared helper reads the ACTIVE
 *  vault's zkBTC mint from the client config, which is wrong here — each
 *  vault has its own mint, so resolve zkBTC from the sibling env instead. */
function siblingScanTargets(env: ChainEnvironment): Array<{ symbol: string; tokenId: bigint }> {
  const client = UTXOpiaClient.instance();
  const targets: Array<{ symbol: string; tokenId: bigint }> = [];
  const seen = new Set<string>();
  for (const token of VAULT_TOKENS) {
    const mint = token.mint || (token.symbol === "zkBTC" ? env.config.tokens.zkbtcMint : "");
    if (!mint) continue;
    try {
      const tokenId = client.getTokenId(mint);
      const key = tokenId.toString(16);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ symbol: token.shieldedSymbol, tokenId });
    } catch {
      // Malformed mint — skip.
    }
  }
  return targets;
}

/** Encoded receive address of the sibling vault's identity, from the warm key
 *  cache. Null while locked/unsupported/view-only. */
export function useSiblingVaultAddress(): string | null {
  const { networkId, vaultId } = useChainEnvironment();
  const hasKeys = useUTXOpiaStore((s) => s.hasKeys);
  const isViewOnly = useUTXOpiaStore((s) => s.isViewOnly);
  const sibling = siblingVaultId(vaultId);
  const [address, setAddress] = useState<string | null>(null);

  useEffect(() => {
    if (!vaultsSupported(networkId) || isViewOnly || !hasKeys) {
      setAddress(null);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const keys = await loadWarmVaultKeys(networkId, sibling);
        if (cancelled || !keys) {
          if (!cancelled) setAddress(null);
          return;
        }
        setAddress(encodeStealthMetaAddress(createStealthMetaAddress(keys)));
      } catch {
        if (!cancelled) setAddress(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [networkId, sibling, hasKeys, isViewOnly]);

  return address;
}

// ---------------------------------------------------------------------------
// Module-level cache.
//
// The scan is expensive (announcement fetch + trial-decrypt of every
// announcement + nullifier fetch) and this hook has four call sites across
// three routes. Held in component state it re-ran from scratch on every
// navigation, and twice over whenever two consumers mounted together — which
// is what the wallet reads as "loading again". Cached per network+vault and
// shared by every subscriber, so a route change repaints from memory and the
// poll runs once regardless of how many components are listening.
// ---------------------------------------------------------------------------

interface CacheEntry {
  status: SiblingVaultStatus;
  balancesByToken: Record<string, bigint>;
  notes: InboxNote[];
  fetchedAt: number;
}

const LOADING_ENTRY: CacheEntry = { status: "loading", balancesByToken: {}, notes: [], fetchedAt: 0 };

const cache = new Map<string, CacheEntry>();
const listeners = new Map<string, Set<() => void>>();
const inflight = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setInterval>>();
/** Identity the cache belongs to. A different login must not read these. */
let cachedIdentity: string | null = null;

function publish(key: string, entry: CacheEntry) {
  cache.set(key, entry);
  listeners.get(key)?.forEach((notify) => notify());
}

async function scanSibling(
  key: string,
  networkId: NetworkId,
  sibling: VaultId,
  force: boolean,
): Promise<void> {
  const cached = cache.get(key);
  if (!force && cached && Date.now() - cached.fetchedAt < REFRESH_INTERVAL_MS) return;
  const running = inflight.get(key);
  if (running) return running;

  const run = (async () => {
    try {
      const keys = await loadWarmVaultKeys(networkId, sibling);
      if (!keys) {
        publish(key, { status: "locked", balancesByToken: {}, notes: [], fetchedAt: Date.now() });
        return;
      }

      const base = getNetworkConfig(networkId);
      const env: ChainEnvironment = {
        networkId,
        vaultId: sibling,
        config: getVaultNetworkConfig(networkId, base, sibling),
      };

      const source = await fetchInboxSource(env);

      const scanned: Array<ScannedNote & { tokenSymbol: string }> = [];
      const seenLeaves = new Set<number>();
      for (const { symbol, tokenId } of siblingScanTargets(env)) {
        const results = await scanUnifiedNotes(keys, source.announcements, tokenId);
        for (const note of results) {
          if (seenLeaves.has(note.leafIndex)) continue;
          seenLeaves.add(note.leafIndex);
          scanned.push({ ...note, tokenSymbol: symbol });
        }
      }

      // Both vaults share one program, so nullifier PDAs are program-global —
      // but the backend indexes them per pool, so this must ask for the
      // sibling's own vault or every sibling note comes back unspent.
      const spentPdas = scanned.length
        ? await fetchSpentNullifierPDAs("", networkId, sibling)
        : new Set<string>();

      const withSpent = scanned.map((note) => {
        const hashHex = Buffer.from(computeNullifierHashForNote(keys, note)).toString("hex");
        return { ...note, nullifierHash: hashHex, isSpent: spentPdas.has(nullifierHashToPDA(hashHex)) };
      });

      publish(key, {
        status: "ready",
        balancesByToken: sumUnspentByToken(withSpent),
        notes: withSpent.map((note, index) => {
          const commitmentHex = Buffer.from(note.commitment)
            .toString("hex")
            .toLowerCase()
            .padStart(64, "0");
          return {
            ...note,
            id: `${commitmentHex.slice(0, 16)}-${index}`,
            commitmentHex,
            createdAt: note.blockTime ? note.blockTime * 1000 : Date.now(),
            vaultId: sibling,
          };
        }),
        fetchedAt: Date.now(),
      });
    } catch {
      // Keep the last good numbers on screen; a failed poll is not new truth.
      const prev = cache.get(key);
      publish(key, prev?.status === "ready" ? prev : { ...LOADING_ENTRY, status: "error" });
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, run);
  return run;
}

export function useSiblingVaultBalances(): SiblingVaultBalances {
  const { networkId, vaultId } = useChainEnvironment();
  const hasKeys = useUTXOpiaStore((s) => s.hasKeys);
  const isViewOnly = useUTXOpiaStore((s) => s.isViewOnly);
  // Identifies the logged-in vault identity: it changes on logout and on any
  // switch, and stale balances from a previous identity must never be shown.
  const identity = useUTXOpiaStore((s) => s.stealthAddressEncoded) ?? "";
  const sibling = siblingVaultId(vaultId);
  const supported = vaultsSupported(networkId);
  const active = supported && !isViewOnly && hasKeys;
  const key = `${networkId}:${sibling}`;

  const [entry, setEntry] = useState<CacheEntry>(() =>
    // cachedIdentity is checked here too: the effect clears a foreign identity's
    // cache, but that is one paint later — long enough to flash its numbers.
    !active
      ? { ...LOADING_ENTRY, status: supported ? "locked" : "unsupported" }
      : cachedIdentity === identity
        ? cache.get(key) ?? LOADING_ENTRY
        : LOADING_ENTRY,
  );
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);
  // Only the run triggered by refresh() bypasses the freshness window; a plain
  // remount reads the cache.
  const handledTick = useRef(refreshTick);

  useEffect(() => {
    if (!active) {
      setEntry({ ...LOADING_ENTRY, status: supported ? "locked" : "unsupported" });
      return;
    }

    if (cachedIdentity !== identity) {
      cachedIdentity = identity;
      cache.clear();
    }

    const read = () => setEntry(cache.get(key) ?? LOADING_ENTRY);
    read();

    let set = listeners.get(key);
    if (!set) {
      set = new Set();
      listeners.set(key, set);
    }
    set.add(read);

    const forced = refreshTick !== handledTick.current;
    handledTick.current = refreshTick;
    void scanSibling(key, networkId, sibling, forced);

    if (!timers.has(key)) {
      timers.set(
        key,
        setInterval(() => void scanSibling(key, networkId, sibling, true), REFRESH_INTERVAL_MS),
      );
    }

    return () => {
      set!.delete(read);
      if (set!.size === 0) {
        listeners.delete(key);
        const timer = timers.get(key);
        if (timer) clearInterval(timer);
        timers.delete(key);
      }
    };
  }, [active, supported, identity, key, networkId, sibling, refreshTick]);

  return {
    status: entry.status,
    vaultId: sibling,
    balancesByToken: entry.balancesByToken,
    notes: entry.notes,
    refresh,
  };
}
