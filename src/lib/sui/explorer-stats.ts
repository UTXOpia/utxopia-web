import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { suiNetworkName, type NetworkConfig } from "@/lib/network-config";

type SuiEvent = Awaited<ReturnType<SuiJsonRpcClient["queryEvents"]>>["data"][number];

export interface SuiExplorerStats {
  totalShielded: bigint;
  depositCount: number;
  totalCommitments: number;
  volume: bigint;
}

async function tryIndexer<T>(config: NetworkConfig, path: string): Promise<T | null> {
  const base = config.sui?.indexerUrl;
  if (!base) return null;
  try {
    const res = await fetch(`${base.replace(/\/$/, "")}${path}`, {
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function safeBigint(value: string): bigint {
  try {
    return BigInt(value);
  } catch {
    return 0n;
  }
}

export async function fetchSuiExplorerStats(config: NetworkConfig): Promise<SuiExplorerStats> {
  const indexed = await tryIndexer<{
    totalShielded: string;
    volume: string;
    depositCount: number;
    totalCommitments: number;
  }>(config, "/api/explorer/stats");
  if (indexed) {
    return {
      totalShielded: safeBigint(indexed.totalShielded),
      volume: safeBigint(indexed.volume),
      depositCount: indexed.depositCount,
      totalCommitments: indexed.totalCommitments,
    };
  }

  const events = await fetchSuiExplorerEvents(config);
  const commitments = new Set<string>();
  let maxLeafIndex = -1;
  let totalShielded = 0n;
  let depositCount = 0;
  let redeemed = 0n;

  for (const event of events) {
    const type = eventName(event);
    const payload = objectPayload(event.parsedJson);

    if (type === "CommitmentInserted") {
      const commitment = bytesField(payload.commitment);
      if (commitment) commitments.add(commitment);
      const leafIndex = bigintField(payload.leaf_index);
      if (leafIndex != null && leafIndex <= BigInt(Number.MAX_SAFE_INTEGER)) {
        maxLeafIndex = Math.max(maxLeafIndex, Number(leafIndex));
      }
    } else if (type === "BtcDepositVerified") {
      const amount = bigintField(payload.amount_sats);
      if (amount != null) {
        totalShielded += amount;
        depositCount += 1;
      }
    } else if (type === "RedemptionRequested") {
      const amount = bigintField(payload.amount_sats);
      if (amount != null) redeemed += amount;
    }
  }

  const totalCommitments = Math.max(commitments.size, maxLeafIndex + 1, 0);
  return {
    totalShielded: totalShielded > redeemed ? totalShielded - redeemed : 0n,
    depositCount,
    totalCommitments,
    volume: totalShielded + redeemed,
  };
}

async function fetchSuiExplorerEvents(config: NetworkConfig): Promise<SuiEvent[]> {
  if (!config.sui) return [];

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

  return events;
}

function eventName(event: SuiEvent): string {
  return event.type.split("::").at(-1) ?? "";
}

function objectPayload(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function stringField(value: unknown): string | undefined {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    if (typeof record.value === "string" || typeof record.value === "number" || typeof record.value === "bigint") {
      return String(record.value);
    }
    if (typeof record.fields === "object" && record.fields) {
      return stringField((record.fields as Record<string, unknown>).value);
    }
  }
  return undefined;
}

function bigintField(value: unknown): bigint | undefined {
  const text = stringField(value);
  if (!text) return undefined;
  try {
    return BigInt(text);
  } catch {
    return undefined;
  }
}

function bytesField(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const bytes = value
    .map((item) => Number(item))
    .filter((item) => Number.isInteger(item) && item >= 0 && item <= 255);
  if (bytes.length !== value.length) return undefined;
  return bytes.map((item) => item.toString(16).padStart(2, "0")).join("");
}
