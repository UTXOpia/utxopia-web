import { PublicKey } from "@solana/web3.js";
import { getConfig } from "@utxopia/sdk";
import { getSolanaRpcUrl } from "@/lib/api/constants";
import { deriveNullifierPDA, getUTXOpiaProgramId } from "@/lib/solana/pdas";
import type { NetworkId } from "@/lib/network-config";
import type { VaultId } from "@/lib/vault-config";

/** Derive nullifier PDA address (base58) from nullifier hash hex */
export function nullifierHashToPDA(hashHex: string): string {
  const clean = hashHex.startsWith("0x") ? hashHex.slice(2) : hashHex;
  const bytes = new Uint8Array(clean.length / 2);
  for (let i = 0; i < bytes.length; i++) {
    bytes[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  // Tree 0 only: this maps historical nullifier hashes to addresses for
  // display, and no rotation has happened. Seeds come from the SDK so this
  // cannot drift from the program on its own.
  const [pda] = deriveNullifierPDA(
    bytes,
    new PublicKey(getConfig().poolStatePda),
    0,
    getUTXOpiaProgramId(),
  );
  return pda.toBase58();
}

// Module-level cache for incremental sync, scoped by backend URL, network and
// vault so switching any of them cannot mix nullifier state from different
// deployments — or, as happened, from different pools on the same one.
const caches = new Map<string, { pdas: Set<string>; latestSlot: number; total: number }>();

function cacheForBackend(
  backendUrl: string,
  network?: NetworkId,
  vault?: VaultId,
): { pdas: Set<string>; latestSlot: number; total: number } {
  const key = `${backendUrl.replace(/\/$/, "")}|${network ?? ""}|${vault ?? ""}`;
  let cache = caches.get(key);
  if (!cache) {
    cache = { pdas: new Set<string>(), latestSlot: 0, total: 0 };
    caches.set(key, cache);
  }
  return cache;
}

/**
 * Fetch spent nullifier PDAs: backend primary, on-chain fallback.
 *
 * `vault` is not optional in practice even though the signature allows it. The
 * backend indexes each pool separately, so omitting it answers for the Open
 * pool: in the Verified vault every spent note came back unspent, balances
 * counted notes that were already gone, and the note selector eventually picked
 * one — surfacing as `custom program error: 0x1774` (NullifierAlreadyUsed) at
 * simulation, which reads like a protocol fault rather than a stale spent set.
 */
export async function fetchSpentNullifierPDAs(
  backendUrl: string,
  network?: NetworkId,
  vault?: VaultId,
): Promise<Set<string>> {
  const normalizedBackendUrl = backendUrl.replace(/\/$/, "");
  const cache = cacheForBackend(normalizedBackendUrl, network, vault);
  // Primary: backend incremental sync
  try {
    const params = new URLSearchParams();
    if (cache.latestSlot > 0) params.set("since", String(cache.latestSlot));
    if (network) params.set("network", network);
    if (vault) params.set("vault", vault);
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
