"use client";

import { toHex64 } from "@/lib/utils/hex";
import {
  EventClient,
  UTXOpiaClient,
  type OnChainStealthAnnouncement,
} from "@utxopia/sdk";
import { deriveSuiTokenId } from "@utxopia/sdk/sui";
import { canonicalSuiCoinType } from "@/lib/sui/coin-type";
import { getChainAdapter } from "@/lib/chain-registry";
import { getBackendUrl, getSolanaRpcUrl } from "@/lib/api/constants";
import { getChainEnvironment, type ChainEnvironment } from "@/lib/chain-environment";
import { suiNetworkName, type NetworkConfig } from "@/lib/network-config";
import { VAULT_TOKENS } from "@/lib/supported-tokens";

export interface InboxSource {
  announcements: OnChainStealthAnnouncement[];
  spentNullifiers?: Set<string>;
}

export interface TokenScanTarget {
  symbol: string;
  tokenId: bigint;
}

const SUI_ZKBTC_TOKEN_ID = 0x7a627463n;

let eventClient: EventClient | null = null;
let eventClientNetwork: string | null = null;

export function getEventClient(): EventClient {
  const env = getChainEnvironment();
  if (eventClient && eventClientNetwork !== env.networkId) {
    eventClient.close();
    eventClient = null;
  }
  if (!eventClient) {
    const backendUrl = "";
    const wsBackendUrl = getBackendUrl(env.networkId);
    const wsUrl = wsBackendUrl.replace("http://", "ws://").replace("https://", "wss://");
    eventClient = new EventClient({
      backendUrl,
      backendWsUrl: wsUrl,
      solanaRpcUrl: getSolanaRpcUrl(),
      programId: UTXOpiaClient.instance().config.utxopiaProgramId,
      commitmentTreeAddress: UTXOpiaClient.instance().config.commitmentTreePda,
    });
    eventClientNetwork = env.networkId;
  }
  return eventClient;
}

export function resetEventClient(): void {
  eventClient = null;
  eventClientNetwork = null;
}

export async function fetchInboxSource(env: ChainEnvironment): Promise<InboxSource> {
  const chain = getChainAdapter(env.config);
  if (chain.id === "sui") {
    return fetchSuiInboxEvents(env.config);
  }
  return { announcements: await getEventClient().fetchAll() };
}

export function getTokenScanTargets(
  env: ChainEnvironment,
  announcements: OnChainStealthAnnouncement[],
): TokenScanTarget[] {
  const chain = getChainAdapter(env.config);
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

  if (chain.id === "sui") {
    pushTokenToScan("zkBTC", SUI_ZKBTC_TOKEN_ID);
    // Registered generic Coin<T> types: derive their token ids so their notes
    // are scannable, and keep a tokenId→symbol map so announcement-sourced ids
    // below get the right display symbol (not a blanket "zkBTC").
    const idToSymbol = new Map<string, string>();
    idToSymbol.set(toHex64(SUI_ZKBTC_TOKEN_ID), "zkBTC");
    const coinMeta = env.config.sui?.coinMetadata ?? {};
    for (const [coinType, meta] of Object.entries(coinMeta)) {
      const tokenId = deriveSuiTokenId(canonicalSuiCoinType(coinType));
      const symbol = meta.symbol ?? coinType.split("::").at(-1) ?? coinType;
      idToSymbol.set(toHex64(tokenId), symbol);
      pushTokenToScan(symbol, tokenId);
    }
    for (const ann of announcements) {
      if (!ann.tokenIdHex) continue;
      try {
        const tokenId = BigInt(`0x${ann.tokenIdHex}`);
        pushTokenToScan(idToSymbol.get(toHex64(tokenId)) ?? "zkBTC", tokenId);
      } catch {
        // Ignore malformed on-chain token ids.
      }
    }
    return tokensToScan;
  }

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
 * Collect auditor-ciphertext events across both chains.
 *
 * - **Sui**: scans the same `BtcDepositVerified` / `StealthAnnounced` events
 *   already used by the inbox path and extracts any non-empty `auditor_ciphertext`
 *   field via {@link auditorCiphertextFromSuiFields}.
 * - **Solana**: performs a lightweight RPC scan (same `getSignaturesForAddress` +
 *   `getTransaction` pattern used by the SDK's announcement client) and parses
 *   disc-0x16 sol_log_data events via {@link parseAuditorCiphertextSegments}.
 *
 * Today this always returns `[]` because no permissioned pools are live yet.
 */
export async function fetchAuditorCiphertexts(
  env: ChainEnvironment,
): Promise<AuditorCiphertextRecord[]> {
  const chain = getChainAdapter(env.config);
  if (chain.id === "sui") {
    return fetchSuiAuditorCiphertexts(env.config);
  }
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

/**
 * Extract an auditor-ciphertext record from a Sui event's parsed JSON fields.
 * The blob rides existing events (`BtcDepositVerified` / `StealthAnnounced`) as
 * an `auditor_ciphertext` field (number[]) and a `commitment` field (number[]).
 * Returns null when `auditor_ciphertext` is absent or empty.
 */
export function auditorCiphertextFromSuiFields(
  payload: Record<string, unknown>,
  blockTime?: number,
): AuditorCiphertextRecord | null {
  const ciphertextField = payload.auditor_ciphertext;
  if (!Array.isArray(ciphertextField) || ciphertextField.length === 0) return null;
  const blob = bytesField(ciphertextField);
  if (!blob || blob.length !== 112) return null;
  const commitment = bytesField(payload.commitment);
  if (!commitment || commitment.length !== 32) return null;
  return { commitment, blob, blockTime };
}

// ---------------------------------------------------------------------------
// Sui auditor ciphertext fetcher
// ---------------------------------------------------------------------------

async function fetchSuiAuditorCiphertexts(
  config: NetworkConfig,
): Promise<AuditorCiphertextRecord[]> {
  if (!config.sui) return [];

  const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");
  type SuiEvent = Awaited<
    ReturnType<InstanceType<typeof SuiJsonRpcClient>["queryEvents"]>
  >["data"][number];
  const client = new SuiJsonRpcClient({
    url: config.sui.rpcUrl,
    network: suiNetworkName(config.sui.rpcUrl),
  });

  const events: SuiEvent[] = [];
  let cursor: { txDigest: string; eventSeq: string } | null = null;

  for (let page = 0; page < 20; page += 1) {
    const result = await client.queryEvents({
      query: {
        MoveEventModule: {
          package: config.sui.eventsPackageId ?? config.sui.packageId,
          module: "events",
        },
      },
      cursor,
      limit: 50,
      order: "descending",
    });
    events.push(...result.data);
    if (!result.hasNextPage || !result.nextCursor) break;
    cursor = result.nextCursor;
  }

  const records: AuditorCiphertextRecord[] = [];

  for (const event of events) {
    const type = event.type.split("::").at(-1) ?? "";
    if (type !== "BtcDepositVerified" && type !== "StealthAnnounced") continue;
    const payload = objectPayload(event.parsedJson);
    const blockTime = Math.floor(Number(event.timestampMs ?? 0) / 1000) || undefined;
    const record = auditorCiphertextFromSuiFields(payload, blockTime);
    if (record) records.push(record);
  }

  return records;
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

      // parseProgramEvents covers all known discs but not 0x16 yet; parse manually
      // by scanning log lines for "Program data: ..." with the auditor ciphertext disc.
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

async function fetchSuiInboxEvents(config: NetworkConfig): Promise<InboxSource> {
  if (!config.sui) return { announcements: [], spentNullifiers: new Set() };

  const { SuiJsonRpcClient } = await import("@mysten/sui/jsonRpc");
  type SuiEvent = Awaited<ReturnType<InstanceType<typeof SuiJsonRpcClient>["queryEvents"]>>["data"][number];
  const client = new SuiJsonRpcClient({
    url: config.sui.rpcUrl,
    network: suiNetworkName(config.sui.rpcUrl),
  });
  const events: SuiEvent[] = [];
  let cursor: { txDigest: string; eventSeq: string } | null = null;

  for (let page = 0; page < 20; page += 1) {
    const result = await client.queryEvents({
      query: {
        MoveEventModule: {
          // Event types keep their original defining-package id across upgrades.
          package: config.sui.eventsPackageId ?? config.sui.packageId,
          module: "events",
        },
      },
      cursor,
      limit: 50,
      order: "descending",
    });
    events.push(...result.data);
    if (!result.hasNextPage || !result.nextCursor) break;
    cursor = result.nextCursor;
  }

  const announcements: OnChainStealthAnnouncement[] = [];
  const spentNullifiers = new Set<string>();

  for (const event of events) {
    const type = event.type.split("::").at(-1) ?? "";
    const payload = objectPayload(event.parsedJson);

    if (type === "BtcDepositVerified") {
      const amount = bigintField(payload.amount_sats);
      const ephemeralPub = bytesField(payload.ephemeral_pubkey);
      const commitment = bytesField(payload.commitment);
      const leafIndex = numberField(payload.leaf_index);
      if (amount == null || !ephemeralPub || !commitment || leafIndex == null) continue;
      announcements.push({
        announcementType: 0,
        ephemeralPub,
        encryptedAmount: u64Le(amount),
        commitment,
        leafIndex,
        blockTime: Math.floor(Number(event.timestampMs ?? 0) / 1000),
        tokenIdHex: toHex64(SUI_ZKBTC_TOKEN_ID),
      });
    } else if (type === "StealthAnnounced") {
      // Generic Coin<T> shield + transact outputs (non-BTC). The on-chain event
      // carries the cleartext amount (mirrors BtcDepositVerified's u64Le packing)
      // plus the token_id, so any registered token's notes are scannable.
      const amount = bigintField(payload.amount);
      const ephemeralPub = bytesField(payload.ephemeral_pub);
      const commitment = bytesField(payload.commitment);
      const leafIndex = numberField(payload.leaf_index);
      const tokenId = bigintField(payload.token_id);
      if (amount == null || !ephemeralPub || !commitment || leafIndex == null) continue;
      // Transfer outputs announce the whole 72-byte stealth blob (ephemeral
      // pub || encrypted amount || padding) with amount=0 and token_id=0 —
      // the token stays private; scanners trial-match registered token ids
      // against the commitment.
      const isStealthBlob = ephemeralPub.length >= 40;
      announcements.push({
        announcementType: numberField(payload.announcement_type) ?? 0,
        ephemeralPub: isStealthBlob ? ephemeralPub.slice(0, 32) : ephemeralPub,
        encryptedAmount: isStealthBlob ? ephemeralPub.slice(32, 40) : u64Le(amount),
        commitment,
        leafIndex,
        blockTime: Math.floor(Number(event.timestampMs ?? 0) / 1000),
        tokenIdHex: tokenId === 0n ? undefined : toHex64(tokenId ?? SUI_ZKBTC_TOKEN_ID),
      });
    } else if (type === "NullifierSpent") {
      const nullifier = bytesField(payload.nullifier);
      if (nullifier) spentNullifiers.add(Buffer.from(nullifier).toString("hex"));
    }
  }

  announcements.sort((a, b) => a.leafIndex - b.leafIndex);
  return { announcements, spentNullifiers };
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
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

function bigintField(value: unknown): bigint | null {
  if (typeof value === "bigint") return value;
  if (typeof value === "number" && Number.isFinite(value)) return BigInt(Math.trunc(value));
  if (typeof value === "string" && /^\d+$/.test(value)) return BigInt(value);
  return null;
}

function numberField(value: unknown): number | null {
  const big = bigintField(value);
  if (big == null || big > BigInt(Number.MAX_SAFE_INTEGER)) return null;
  return Number(big);
}

function u64Le(value: bigint): Uint8Array {
  const out = new Uint8Array(8);
  new DataView(out.buffer).setBigUint64(0, value, true);
  return out;
}
