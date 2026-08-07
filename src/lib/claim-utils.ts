"use client";

import { toHex64 } from "@/lib/utils/hex";
import {
  initPoseidon,
  deriveMasterKey,
  deriveKeysFromSeedCircuit,
  computeJoinSplitNullifierSync,
  scanUnifiedNotes,
  type UTXOpiaKeys,
} from "@utxopia/sdk";
import { fetchSpentNullifierPDAs, nullifierHashToPDA } from "@/lib/nullifier-utils";
import { getBackendUrl } from "@/lib/api/constants";
import type { NetworkId } from "@/lib/network-config";
import {
  fetchInboxSource,
  getTokenScanTargets,
} from "@/lib/chain-inbox";
import {
  ensureChainEnvironment,
  getChainEnvironment,
} from "@/lib/chain-environment";

export interface ScannedSecretNote {
  amount: number;
  leafIndex: bigint;
  commitment: string;
  nullifierHash: string;
  isSpent: boolean;
  ephemeralPub: Uint8Array;
  stealthPub?: { x: bigint; y: bigint };
  tokenSymbol: string;
  blockTime: number;
  /** Full UTXOpiaKeys derived from phrase — use for scanning, signing, and proof generation */
  keys: UTXOpiaKeys;
}

/**
 * Scan a secret phrase to find ALL matching on-chain notes (spent and unspent).
 * Derives full UTXOpiaKeys from the phrase, scans stealth announcements
 * using the viewing key (same as normal inbox scanning), and checks nullifiers.
 */
export async function scanSecretPhrase(
  phrase: string,
  network?: NetworkId,
): Promise<ScannedSecretNote[]> {
  if (phrase.trim().length < 8) {
    throw new Error("Secret phrase must be at least 8 characters");
  }

  await initPoseidon();

  // Derive UTXOpiaKeys from phrase with circomlibjs-compatible spending keys.
  const masterKey = deriveMasterKey(phrase.trim());
  const keys = await deriveKeysFromSeedCircuit(masterKey);

  await ensureChainEnvironment();
  const env = getChainEnvironment();
  const inboxSource = await fetchInboxSource(env);
  const announcements = inboxSource.announcements;

  // Claim links can hold any supported shielded token. Scan every configured
  // token id, then deduplicate by leaf because a note can only match one token.
  const scannedNotes: Array<
    Awaited<ReturnType<typeof scanUnifiedNotes>>[number] & { tokenSymbol: string }
  > = [];
  const seenLeaves = new Set<number>();
  for (const { symbol, tokenId } of getTokenScanTargets(env, announcements)) {
    const matches = await scanUnifiedNotes(keys, announcements, tokenId);
    for (const note of matches) {
      if (seenLeaves.has(note.leafIndex)) continue;
      seenLeaves.add(note.leafIndex);
      scannedNotes.push({ ...note, tokenSymbol: symbol });
    }
  }

  if (scannedNotes.length === 0) {
    throw new Error(
      "Commitment not found. Please ensure your deposit has been confirmed on-chain."
    );
  }

  // Fetch spent nullifier PDAs, match client-side (privacy: backend never learns which notes we own)
  const backendUrl = getBackendUrl(network);
  const spentPdas = inboxSource.spentNullifiers
    ? null
    : await fetchSpentNullifierPDAs(backendUrl, network, env.vaultId);

  const results: ScannedSecretNote[] = [];
  for (const note of scannedNotes) {
    const commitmentHex = Buffer.from(note.commitment).toString("hex").padStart(64, "0");
    const leafIndexBigint = BigInt(note.leafIndex);
    const nullifierValue = computeJoinSplitNullifierSync(keys.nullifyingKey, leafIndexBigint);
    const nullifierHex = toHex64(nullifierValue);

    results.push({
      amount: Number(note.amount),
      leafIndex: leafIndexBigint,
      commitment: commitmentHex,
      nullifierHash: nullifierHex,
      isSpent: inboxSource.spentNullifiers
        ? inboxSource.spentNullifiers.has(nullifierHex)
        : spentPdas!.has(nullifierHashToPDA(nullifierHex)),
      ephemeralPub: note.ephemeralPub,
      stealthPub: note.stealthPub,
      tokenSymbol: note.tokenSymbol,
      blockTime: note.blockTime ?? 0,
      keys,
    });
  }

  // Sort: unspent first, then by leafIndex descending
  results.sort((a, b) => {
    if (a.isSpent !== b.isSpent) return a.isSpent ? 1 : -1;
    return Number(b.leafIndex - a.leafIndex);
  });

  const unspent = results.filter(n => !n.isSpent);
  if (unspent.length === 0) {
    throw new Error("All notes for this phrase have been spent.");
  }

  return results;
}

/**
 * Re-check nullifier status for a list of imported notes.
 * Returns updated notes with fresh isSpent values.
 */
export async function refreshNullifierStatus(
  notes: ScannedSecretNote[],
  network?: NetworkId,
): Promise<ScannedSecretNote[]> {
  const backendUrl = getBackendUrl(network);
  // Per-pool index: without the vault this answers for Open and every Verified
  // note reads as unspent.
  const spentPdas = await fetchSpentNullifierPDAs(
    backendUrl, network, getChainEnvironment().vaultId,
  );

  return notes.map((n) => ({
    ...n,
    isSpent: spentPdas.has(nullifierHashToPDA(n.nullifierHash)),
  }));
}
