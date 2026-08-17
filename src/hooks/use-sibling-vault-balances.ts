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
} from "@utxopia/sdk";
import { useChainEnvironment, type ChainEnvironment } from "@/lib/chain-environment";
import { getNetworkConfig, type NetworkId } from "@/lib/network-config";
import {
  getVaultNetworkConfig,
  siblingVaultId,
  vaultsSupported,
  type VaultId,
} from "@/lib/vault-config";
import { fetchInboxSource, planTokenScan, scanByTokenPlan } from "@/lib/chain-inbox";
import { fetchSpentNullifierPDAs, nullifierHashToPDA } from "@/lib/nullifier-utils";
import {
  hasVaultScanListeners,
  isScanLogin,
  LOADING_SCAN,
  peekVaultScan,
  publishVaultScan,
  setScanLogin,
  subscribeVaultScan,
  vaultScanKey,
  type VaultScanEntry,
  type VaultScanStatus,
} from "@/lib/vault-scan-cache";
import { loadWarmVaultKeys, useUTXOpiaStore, type InboxNote } from "@/stores/utxopia-store";

export type SiblingVaultStatus = VaultScanStatus;

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
// The scan is expensive (announcement fetch + trial-decrypt of every
// announcement + nullifier fetch) and this hook has four call sites across
// three routes. Held in component state it re-ran from scratch on every
// navigation, and twice over whenever two consumers mounted together — which
// is what the wallet reads as "loading again". Results live in the shared
// vault-scan cache instead, so a route change repaints from memory, the poll
// runs once regardless of how many components are listening, and a vault
// switch hands this scan straight to the store as the active balance.
// ---------------------------------------------------------------------------

const inflight = new Map<string, Promise<void>>();
const timers = new Map<string, ReturnType<typeof setInterval>>();

async function scanSibling(
  key: string,
  networkId: NetworkId,
  sibling: VaultId,
  force: boolean,
): Promise<void> {
  const cached = peekVaultScan(key);
  if (!force && cached && Date.now() - cached.fetchedAt < REFRESH_INTERVAL_MS) return;
  const running = inflight.get(key);
  if (running) return running;

  const run = (async () => {
    try {
      const keys = await loadWarmVaultKeys(networkId, sibling);
      if (!keys) {
        publishVaultScan(key, { ...LOADING_SCAN, status: "locked", fetchedAt: Date.now() });
        return;
      }
      const owner = encodeStealthMetaAddress(createStealthMetaAddress(keys));

      const base = getNetworkConfig(networkId);
      const env: ChainEnvironment = {
        networkId,
        vaultId: sibling,
        config: getVaultNetworkConfig(networkId, base, sibling),
      };

      const source = await fetchInboxSource(env);
      // The plan resolves zkBTC from the env passed here, not the active SDK
      // config — each vault mints its own, so the sibling would otherwise be
      // scanned for the wrong one.
      const scanned = await scanByTokenPlan(
        planTokenScan(env, source.announcements),
        (rows, tokenId) => scanUnifiedNotes(keys, rows, tokenId),
      );

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

      publishVaultScan(key, {
        status: "ready",
        owner,
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
      const prev = peekVaultScan(key);
      publishVaultScan(key, prev?.status === "ready" ? prev : { ...LOADING_SCAN, status: "error" });
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
  // Identifies the login the cache belongs to. The root seed where there is
  // one: it survives a vault switch — which is what lets the two vaults hand
  // their scans to each other — and only a real sign-out replaces it. Sessions
  // without a root fall back to the active address, which does change on a
  // switch: no hand-off there, but no stale numbers either.
  const rootSeed = useUTXOpiaStore((s) => s.vaultSeed);
  const address = useUTXOpiaStore((s) => s.stealthAddressEncoded) ?? "";
  const login: unknown = rootSeed ?? address;
  const sibling = siblingVaultId(vaultId);
  const supported = vaultsSupported(networkId);
  const active = supported && !isViewOnly && hasKeys;
  const key = vaultScanKey(networkId, sibling);

  const [entry, setEntry] = useState<VaultScanEntry>(() =>
    // The login is checked here too: the effect clears a foreign one's cache,
    // but that is one paint later — long enough to flash its numbers.
    !active
      ? { ...LOADING_SCAN, status: supported ? "locked" : "unsupported" }
      : isScanLogin(login)
        ? peekVaultScan(key) ?? LOADING_SCAN
        : LOADING_SCAN,
  );
  const [refreshTick, setRefreshTick] = useState(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);
  // Only the run triggered by refresh() bypasses the freshness window; a plain
  // remount reads the cache.
  const handledTick = useRef(refreshTick);

  useEffect(() => {
    if (!active) {
      setEntry({ ...LOADING_SCAN, status: supported ? "locked" : "unsupported" });
      return;
    }

    setScanLogin(login);

    const read = () => setEntry(peekVaultScan(key) ?? LOADING_SCAN);
    read();
    const unsubscribe = subscribeVaultScan(key, read);

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
      unsubscribe();
      if (hasVaultScanListeners(key)) return;
      const timer = timers.get(key);
      if (timer) clearInterval(timer);
      timers.delete(key);
    };
  }, [active, supported, login, key, networkId, sibling, refreshTick]);

  return {
    status: entry.status,
    vaultId: sibling,
    balancesByToken: entry.balancesByToken,
    notes: entry.notes,
    refresh,
  };
}
