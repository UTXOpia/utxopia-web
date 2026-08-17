"use client";

import { toHex64 } from "@/lib/utils/hex";
import {
  EventClient,
  parseAnnouncementsFromHex,
  UTXOpiaClient,
  type OnChainStealthAnnouncement,
} from "@utxopia/sdk";
import { getBackendUrl, getSolanaRpcUrl } from "@/lib/api/constants";
import { getChainEnvironment, type ChainEnvironment } from "@/lib/chain-environment";
import { VAULT_TOKENS } from "@/lib/supported-tokens";

export interface InboxSource {
  announcements: OnChainStealthAnnouncement[];
  spentNullifiers?: Set<string>;
}

export interface TokenScanTarget {
  symbol: string;
  tokenId: bigint;
}

/** A token id paired with the announcements worth trying against it. */
export interface TokenScanGroup extends TokenScanTarget {
  announcements: OnChainStealthAnnouncement[];
}

let eventClient: EventClient | null = null;
let eventClientIdentity: string | null = null;

export function getEventClient(env: ChainEnvironment = getChainEnvironment()): EventClient {
  const identity = `${env.networkId}:${env.vaultId}`;
  if (eventClient && eventClientIdentity !== identity) {
    eventClient.close();
    eventClient = null;
  }
  if (!eventClient) {
    const backendUrl = "";
    const wsBackendUrl = env.config.backend.url || getBackendUrl(env.networkId);
    const wsUrl = wsBackendUrl.replace("http://", "ws://").replace("https://", "wss://");
    eventClient = new EventClient({
      backendUrl,
      backendWsUrl: wsUrl,
      solanaRpcUrl: getSolanaRpcUrl(),
      programId: UTXOpiaClient.instance().config.utxopiaProgramId,
      commitmentTreeAddress: UTXOpiaClient.instance().config.commitmentTreePda,
    });
    eventClientIdentity = identity;
  }
  return eventClient;
}

export function resetEventClient(): void {
  eventClient = null;
  eventClientIdentity = null;
}

/**
 * Fetch inbox announcements. Announcements are append-only, so passing
 * `sinceLeafIndex` returns only what landed after it (exclusive) — the polling
 * caller then decrypts new leaves instead of the whole history every 60s.
 */
export async function fetchInboxSource(
  env: ChainEnvironment,
  sinceLeafIndex?: number,
): Promise<InboxSource> {
  return {
    announcements: await fetchSolanaInboxAnnouncements(env, sinceLeafIndex),
  };
}

interface BackendAnnouncementRow {
  leaf_index: number;
  announcement_type: number;
  ephemeral_pub: string;
  encrypted_amount: string;
  commitment: string;
  token_id?: string | null;
  block_time?: number | null;
  slot?: number | null;
}

async function fetchSolanaInboxAnnouncements(
  env: ChainEnvironment,
  sinceLeafIndex?: number,
): Promise<OnChainStealthAnnouncement[]> {
  try {
    const params = new URLSearchParams({ network: env.networkId, vault: env.vaultId });
    if (sinceLeafIndex !== undefined && sinceLeafIndex >= 0) {
      params.set("since", String(sinceLeafIndex));
    }
    const resp = await fetch(`/api/announcements?${params.toString()}`, { cache: "no-store" });
    if (!resp.ok) throw new Error(`announcements proxy ${resp.status}`);

    const data = await resp.json() as { success?: boolean; announcements?: BackendAnnouncementRow[] };
    if (data.success === false) throw new Error("announcements proxy returned success=false");

    const rows = data.announcements ?? [];
    const parsed = parseAnnouncementsFromHex(rows);
    return parsed.map((ann, index) => ({
      ...ann,
      blockTime: rows[index]?.block_time ?? 0,
      slot: rows[index]?.slot ?? undefined,
    }));
  } catch (err) {
    console.warn("[ChainInbox] backend announcements fetch failed; falling back to EventClient:", err);
    const all = await getEventClient(env).fetchAll();
    return sinceLeafIndex === undefined || sinceLeafIndex < 0
      ? all
      : all.filter((ann) => ann.leafIndex > sinceLeafIndex);
  }
}

/** The configured shielded tokens. zkBTC resolves from the passed env, not the
 *  active SDK config: each vault mints its own, so the sibling's scan would
 *  otherwise look for the wrong one. */
export function configuredTokenTargets(env: ChainEnvironment): TokenScanTarget[] {
  const utxopiaClient = UTXOpiaClient.instance();
  const targets: TokenScanTarget[] = [];
  const seen = new Set<string>();

  for (const token of VAULT_TOKENS) {
    const mint = token.mint || (token.symbol === "zkBTC" ? env.config.tokens.zkbtcMint : "");
    if (!mint) continue;
    try {
      const tokenId = utxopiaClient.getTokenId(mint);
      const key = toHex64(tokenId);
      if (seen.has(key)) continue;
      seen.add(key);
      targets.push({ symbol: token.shieldedSymbol, tokenId });
    } catch (err) {
      console.error("[ChainInbox] invalid mint for token:", token.symbol, err);
    }
  }

  return targets;
}

/** Indexed token id, or null when the row carries none. All-zero counts as
 *  none: a real token id is a hash of the mint and never lands there. */
function indexedTokenId(hex: string | undefined): bigint | null {
  if (!hex) return null;
  try {
    const tokenId = BigInt(`0x${hex}`);
    return tokenId === 0n ? null : tokenId;
  } catch {
    return null;
  }
}

/**
 * Split the feed so each announcement is trial-decrypted once rather than once
 * per token id.
 *
 * scanUnifiedNotes redoes the x25519 ECDH for every announcement on every call,
 * and only the closing commitment check depends on the token id — so scanning N
 * announcements against T targets costs N×T ECDHs for N×1 worth of answers.
 * T used to be "every distinct token id in the feed", which on devnet is 20–40,
 * and that multiplier is where the seconds went.
 *
 * Rows the indexer tagged with a token we know are scanned under that token
 * alone. Untagged rows — most transfers — and rows tagged with an id we don't
 * recognise still go through the full configured set, because there the tag
 * can't be trusted to say which token the commitment was built with.
 */
export function planTokenScan(
  env: ChainEnvironment,
  announcements: OnChainStealthAnnouncement[],
): TokenScanGroup[] {
  return planTokenScanFor(configuredTokenTargets(env), announcements);
}

/** planTokenScan with the configured tokens passed in. Exported for tests. */
export function planTokenScanFor(
  configured: TokenScanTarget[],
  announcements: OnChainStealthAnnouncement[],
): TokenScanGroup[] {
  const configuredKeys = new Set(configured.map((t) => toHex64(t.tokenId)));
  const tagged = new Map<string, OnChainStealthAnnouncement[]>();
  const unknown = new Map<string, { tokenId: bigint; announcements: OnChainStealthAnnouncement[] }>();
  const untagged: OnChainStealthAnnouncement[] = [];

  for (const ann of announcements) {
    const tokenId = indexedTokenId(ann.tokenIdHex);
    if (tokenId === null) {
      untagged.push(ann);
      continue;
    }
    const key = toHex64(tokenId);
    if (configuredKeys.has(key)) {
      const rows = tagged.get(key);
      if (rows) rows.push(ann);
      else tagged.set(key, [ann]);
    } else {
      const group = unknown.get(key);
      if (group) group.announcements.push(ann);
      else unknown.set(key, { tokenId, announcements: [ann] });
    }
  }

  const fallback = [...untagged, ...[...unknown.values()].flatMap((g) => g.announcements)];
  const plan: TokenScanGroup[] = [];

  // Configured tokens first: a leaf they claim keeps their symbol, which is
  // what the untagged rows would otherwise be labelled by the unknown groups.
  for (const { symbol, tokenId } of configured) {
    const rows = [...(tagged.get(toHex64(tokenId)) ?? []), ...fallback];
    if (rows.length) plan.push({ symbol, tokenId, announcements: rows });
  }
  for (const { tokenId, announcements: rows } of unknown.values()) {
    plan.push({ symbol: "zkBTC", tokenId, announcements: rows });
  }

  return plan;
}

/** Run a scan plan and label each hit with its token, first match per leaf.
 *  `seenLeaves` carries the leaves an incremental caller already holds. */
export async function scanByTokenPlan<T extends { leafIndex: number }>(
  plan: TokenScanGroup[],
  scan: (announcements: OnChainStealthAnnouncement[], tokenId: bigint) => Promise<T[]>,
  seenLeaves: Set<number> = new Set(),
): Promise<Array<T & { tokenSymbol: string }>> {
  const found: Array<T & { tokenSymbol: string }> = [];
  for (const group of plan) {
    for (const note of await scan(group.announcements, group.tokenId)) {
      if (seenLeaves.has(note.leafIndex)) continue;
      seenLeaves.add(note.leafIndex);
      found.push({ ...note, tokenSymbol: group.symbol });
    }
  }
  return found;
}

// ---------------------------------------------------------------------------
// Auditor-ciphertext collection
// ---------------------------------------------------------------------------

/**
 * Discriminator byte for the auditor-ciphertext sol_log_data event (0x16 = 22).
 * Layout: disc(1) + commitment(32) + blob(112) = three segments.
 */
const EVENT_AUDITOR_CIPHERTEXT = 0x16;

/** Auditor-ciphertext blob as returned by fetchAuditorCiphertexts. */
export interface AuditorCiphertextRecord {
  commitment: Uint8Array;
  /** 112-byte encrypted blob for the designated auditor. */
  blob: Uint8Array;
  /** Solana slot (Solana path only). */
  slot?: number;
  /** Unix timestamp in seconds (both paths, when available). */
  blockTime?: number;
}

/**
 * Collect auditor-ciphertext events on Solana.
 *
 * Performs a lightweight RPC scan (same `getSignaturesForAddress` +
 * `getTransaction` pattern used by the SDK's announcement client) and parses
 * disc-0x16 sol_log_data events via {@link parseAuditorCiphertextSegments}.
 *
 * Today this always returns `[]` because no permissioned pools are live yet.
 */
export async function fetchAuditorCiphertexts(
  // eslint-disable-next-line @typescript-eslint/no-unused-vars -- env kept for API symmetry with fetchInboxSource
  env: ChainEnvironment,
): Promise<AuditorCiphertextRecord[]> {
  return fetchSolanaAuditorCiphertexts();
}

// ---------------------------------------------------------------------------
// Internal parsers (mirrors SDK spec; implemented here until SDK ships them)
// ---------------------------------------------------------------------------

/**
 * Parse a disc-0x16 auditor-ciphertext event from sol_log_data segments.
 * Expected layout: [disc(1)] [commitment(32)] [blob(112)]
 * Returns null if segments are missing, wrong size, or disc doesn't match.
 */
export function parseAuditorCiphertextSegments(
  segments: Uint8Array[],
): { commitment: Uint8Array; blob: Uint8Array } | null {
  if (segments.length < 3) return null;
  if (segments[0].length !== 1 || segments[0][0] !== EVENT_AUDITOR_CIPHERTEXT) return null;
  if (segments[1].length !== 32) return null;
  if (segments[2].length !== 112) return null;
  return {
    commitment: segments[1],
    blob: segments[2],
  };
}

// ---------------------------------------------------------------------------
// Solana auditor ciphertext fetcher
// ---------------------------------------------------------------------------

async function fetchSolanaAuditorCiphertexts(): Promise<AuditorCiphertextRecord[]> {
  const utxopiaClient = UTXOpiaClient.instance();
  const programId = utxopiaClient.config.utxopiaProgramId;
  const commitmentTreeAddress = utxopiaClient.config.commitmentTreePda;
  const rpcUrl = getSolanaRpcUrl();
  const queryAddress = commitmentTreeAddress || programId;

  // Fetch recent signatures
  let signatures: Array<{ signature: string; slot: number; blockTime?: number | null }> = [];
  try {
    const sigsResp = await fetch(rpcUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getSignaturesForAddress",
        params: [queryAddress, { limit: 200 }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const sigsData: { result?: Array<{ signature: string; slot: number; blockTime?: number | null }> } =
      await sigsResp.json();
    signatures = sigsData.result ?? [];
  } catch {
    // Network error — return empty (inert today)
    return [];
  }

  if (signatures.length === 0) return [];

  const records: AuditorCiphertextRecord[] = [];
  const batchSize = 10;

  for (let i = 0; i < signatures.length; i += batchSize) {
    const batch = signatures.slice(i, i + batchSize);
    let txResponses: Array<{ result?: { meta?: { logMessages?: string[] }; slot?: number; blockTime?: number | null } }>;
    try {
      txResponses = await Promise.all(
        batch.map((s) =>
          fetch(rpcUrl, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getTransaction",
              params: [s.signature, { encoding: "json", maxSupportedTransactionVersion: 0 }],
            }),
            signal: AbortSignal.timeout(10_000),
          }).then((r) => r.json() as Promise<typeof txResponses[number]>),
        ),
      );
    } catch {
      continue;
    }

    for (let j = 0; j < txResponses.length; j++) {
      const txData = txResponses[j];
      const logs = txData?.result?.meta?.logMessages;
      if (!Array.isArray(logs)) continue;

      const sig = batch[j];
      const slot = txData.result?.slot ?? sig.slot;
      const blockTime = txData.result?.blockTime ?? sig.blockTime ?? undefined;

      // Scan "Program data: ..." log lines for the 0x16 auditor-ciphertext disc and
      // parse locally via parseAuditorCiphertextSegments (equivalent to the SDK's
      // parseAuditorCiphertextEvent; kept local to avoid a hot-path SDK import here).
      for (const line of logs) {
        if (!line.startsWith("Program data: ")) continue;
        const parts = line.slice("Program data: ".length).trim().split(" ");
        const segments = parts.map((p) => {
          try {
            return Uint8Array.from(Buffer.from(p, "base64"));
          } catch {
            return new Uint8Array(0);
          }
        });
        const parsed = parseAuditorCiphertextSegments(segments);
        if (parsed) {
          records.push({
            ...parsed,
            slot,
            blockTime: typeof blockTime === "number" ? blockTime : undefined,
          });
        }
      }
    }
  }

  return records;
}

