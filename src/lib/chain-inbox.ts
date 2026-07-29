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

export async function fetchInboxSource(env: ChainEnvironment): Promise<InboxSource> {
  return {
    announcements: await fetchSolanaInboxAnnouncements(env),
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
): Promise<OnChainStealthAnnouncement[]> {
  try {
    const params = new URLSearchParams({ network: env.networkId, vault: env.vaultId });
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
    return getEventClient(env).fetchAll();
  }
}

export function getTokenScanTargets(
  env: ChainEnvironment,
  announcements: OnChainStealthAnnouncement[],
): TokenScanTarget[] {
  const utxopiaClient = UTXOpiaClient.instance();
  const config = utxopiaClient.config;
  const tokensToScan: TokenScanTarget[] = [];
  const seenTokenIds = new Set<string>();
  const pushTokenToScan = (symbol: string, tokenId: bigint) => {
    const key = toHex64(tokenId);
    if (seenTokenIds.has(key)) return;
    seenTokenIds.add(key);
    tokensToScan.push({ symbol, tokenId });
  };

  for (const token of VAULT_TOKENS) {
    try {
      let mintAddr = token.mint;
      if (!mintAddr && token.symbol === "zkBTC") mintAddr = config.zkbtcMint;
      if (!mintAddr) continue;
      pushTokenToScan(token.shieldedSymbol, utxopiaClient.getTokenId(mintAddr));
    } catch (err) {
      console.error("[ChainInbox] invalid mint for token:", token.symbol, err);
    }
  }

  for (const ann of announcements) {
    if (!ann.tokenIdHex) continue;
    try {
      const tokenId = BigInt(`0x${ann.tokenIdHex}`);
      pushTokenToScan("zkBTC", tokenId);
    } catch {
      // Ignore malformed backend token ids.
    }
  }

  return tokensToScan;
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

function bytesField(value: unknown): Uint8Array | null {
  if (Array.isArray(value)) {
    const bytes = value.map((entry) => Number(entry));
    if (bytes.every((entry) => Number.isInteger(entry) && entry >= 0 && entry <= 255)) {
      return Uint8Array.from(bytes);
    }
    return null;
  }
  if (typeof value === "string") {
    const normalized = value.replace(/^0x/, "");
    if (/^[0-9a-fA-F]*$/.test(normalized) && normalized.length % 2 === 0) {
      return Uint8Array.from(Buffer.from(normalized, "hex"));
    }
  }
  return null;
}
