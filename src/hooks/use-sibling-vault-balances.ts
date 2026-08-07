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
import { getNetworkConfig } from "@/lib/network-config";
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

export function useSiblingVaultBalances(): SiblingVaultBalances {
  const { networkId, vaultId } = useChainEnvironment();
  const hasKeys = useUTXOpiaStore((s) => s.hasKeys);
  const isViewOnly = useUTXOpiaStore((s) => s.isViewOnly);
  const sibling = siblingVaultId(vaultId);
  const supported = vaultsSupported(networkId);

  const [status, setStatus] = useState<SiblingVaultStatus>(
    supported ? "loading" : "unsupported",
  );
  const [balancesByToken, setBalancesByToken] = useState<Record<string, bigint>>({});
  const [notes, setNotes] = useState<InboxNote[]>([]);
  const [refreshTick, setRefreshTick] = useState(0);
  const generation = useRef(0);

  const refresh = useCallback(() => setRefreshTick((t) => t + 1), []);

  useEffect(() => {
    if (!supported || isViewOnly || !hasKeys) {
      setStatus(supported ? "locked" : "unsupported");
      setBalancesByToken({});
      setNotes([]);
      return;
    }

    const gen = ++generation.current;
    let cancelled = false;
    const live = () => !cancelled && generation.current === gen;

    const run = async () => {
      try {
        const keys = await loadWarmVaultKeys(networkId, sibling);
        if (!live()) return;
        if (!keys) {
          setStatus("locked");
          setBalancesByToken({});
          setNotes([]);
          return;
        }

        setStatus((prev) => (prev === "ready" ? prev : "loading"));

        const base = getNetworkConfig(networkId);
        const env: ChainEnvironment = {
          networkId,
          vaultId: sibling,
          config: getVaultNetworkConfig(networkId, base, sibling),
        };

        const source = await fetchInboxSource(env);
        if (!live()) return;

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
        if (!live()) return;

        // Both vaults share one program, so nullifier PDAs are program-global —
        // but the backend indexes them per pool, so this must ask for the
        // sibling's own vault or every sibling note comes back unspent.
        const spentPdas = scanned.length
          ? await fetchSpentNullifierPDAs("", networkId, sibling)
          : new Set<string>();
        if (!live()) return;

        const withSpent = scanned.map((note) => {
          const hashHex = Buffer.from(computeNullifierHashForNote(keys, note)).toString("hex");
          return { ...note, nullifierHash: hashHex, isSpent: spentPdas.has(nullifierHashToPDA(hashHex)) };
        });

        setBalancesByToken(sumUnspentByToken(withSpent));
        setNotes(withSpent.map((note, index) => {
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
        }));
        setStatus("ready");
      } catch {
        if (!live()) return;
        setStatus("error");
      }
    };

    void run();
    const interval = setInterval(() => void run(), REFRESH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [supported, isViewOnly, hasKeys, networkId, sibling, refreshTick]);

  return { status, vaultId: sibling, balancesByToken, notes, refresh };
}
