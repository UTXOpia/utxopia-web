import { PublicKey } from "@solana/web3.js";
import { PDA_SEEDS, getConfig } from "@utxopia/sdk";
import { getSolanaRpcUrl } from "@/lib/api/constants";
import type { NetworkId } from "@/lib/network-config";

/** Derive nullifier PDA address (base58) from nullifier hash hex */
export function nullifierHashToPDA(hashHex: string): string {
  const clean = hashHex.startsWith("0x") ? hashHex.slice(2) : hashHex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  // Pool-scoped, matching the program. Tree 0 only: this maps historical
  // nullifier hashes to addresses for display, and no rotation has happened.
  const [pda] = PublicKey.findProgramAddressSync(
    [
      Buffer.from(PDA_SEEDS.NULLIFIER),
      new PublicKey(getConfig().poolStatePda).toBuffer(),
      bytes,
    ],
    new PublicKey(getConfig().utxopiaProgramId)
  );
  return pda.toBase58();
}

// Module-level cache for incremental sync, scoped by backend URL so switching
// app networks cannot mix nullifier state from different deployments.
const caches = new Map<string, { pdas: Set<string>; latestSlot: number; total: number }>();

function cacheForBackend(backendUrl: string, network?: NetworkId): { pdas: Set<string>; latestSlot: number; total: number } {
  const key = `${backendUrl.replace(/\/$/, "")}|${network ?? ""}`;
  let cache = caches.get(key);
  if (!cache) {
    cache = { pdas: new Set<string>(), latestSlot: 0, total: 0 };
    caches.set(key, cache);
  }
  return cache;
}

/** Fetch spent nullifier PDAs: backend primary, on-chain fallback */
export async function fetchSpentNullifierPDAs(backendUrl: string, network?: NetworkId): Promise<Set<string>> {
  const normalizedBackendUrl = backendUrl.replace(/\/$/, "");
  const cache = cacheForBackend(normalizedBackendUrl, network);
  // Primary: backend incremental sync
  try {
    const params = new URLSearchParams();
    if (cache.latestSlot > 0) params.set("since", String(cache.latestSlot));
    if (network) params.set("network", network);
    const query = params.toString();
    const resp = await fetch(`${normalizedBackendUrl}/api/nullifiers${query ? `?${query}` : ""}`);
    const data = await resp.json();
    for (const pda of (data.pdas || [])) cache.pdas.add(pda);
    if (data.latest_slot > cache.latestSlot) cache.latestSlot = data.latest_slot;
    cache.total = data.total ?? cache.pdas.size;
    return cache.pdas;
  } catch {
    // Fallback: on-chain getProgramAccounts(dataSize: 1)
    try {
      const rpcUrl = getSolanaRpcUrl();
      const resp = await fetch(rpcUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "getProgramAccounts",
          params: [
            getConfig().utxopiaProgramId,
            { filters: [{ dataSize: 1 }], encoding: "base64" },
          ],
        }),
      });
      const result = await resp.json();
      return new Set(
        (result?.result || []).map((a: { pubkey: string }) => a.pubkey)
      );
    } catch {
      return cache.pdas; // return whatever we have cached
    }
  }
}
