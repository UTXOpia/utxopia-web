/**
 * GET /api/explorer/transactions
 *
 * Tries backend /api/explorer/transactions first.
 * Falls back to combining /api/explorer/deposits + /api/transfers
 * so pending BTC deposits (tracker-only) always appear.
 */

import { NextResponse } from "next/server";
import { detectNetworkFromRequest } from "@/lib/network-config";
import { parseVaultScope, tagVault, vaultTargets } from "@/lib/api/vault-fanout";
import type { VaultId } from "@/lib/vault-config";
import { ExplorerTx, normalizeExplorerTransaction } from "./helpers";
export const dynamic = "force-dynamic";

async function fetchFromBackendUnified(backendUrl: string): Promise<ExplorerTx[] | null> {
  try {
    const resp = await fetch(`${backendUrl}/api/explorer/transactions`, { cache: "no-store" });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (!data.success) return null;
    return data.transactions ?? [];
  } catch {
    return null;
  }
}

/** Fallback: combine deposits + transfers from separate endpoints */
async function fetchCombined(
  origin: string,
  cookieHeader: string | null,
  vaultId: VaultId | null,
): Promise<ExplorerTx[]> {
  // Forward the network cookie so sub-routes resolve the same backend, and the
  // vault so they read the same pool this target is for.
  const headers: Record<string, string> = {};
  if (cookieHeader) headers["cookie"] = cookieHeader;
  const query = vaultId ? `?vault=${vaultId}` : "";
  const [depositsResp, transfersResp] = await Promise.all([
    fetch(`${origin}/api/explorer/deposits${query}`, { cache: "no-store", headers }).catch(() => null),
    fetch(`${origin}/api/transfers${query}`, { cache: "no-store", headers }).catch(() => null),
  ]);

  const deposits: ExplorerTx[] = depositsResp?.ok
    ? ((await depositsResp.json()).transactions ?? [])
    : [];
  const transfers: ExplorerTx[] = transfersResp?.ok
    ? ((await transfersResp.json()).transactions ?? [])
    : [];

  const all = [...deposits, ...transfers];
  all.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));
  return all;
}

export async function GET(request: Request) {
  try {
    // Resolve backend URL per-request from the network cookie so the user's
    // selection in /settings reaches the right stack.
    const network = detectNetworkFromRequest(request);
    const scope = parseVaultScope(new URL(request.url).searchParams.get("vault"));
    const origin = new URL(request.url).origin;
    const cookie = request.headers.get("cookie");

    // One backend per requested vault; rows carry the pool they came from.
    const perVault = await Promise.all(
      vaultTargets(network, scope).map(async ({ vaultId, backendUrl }) => {
        const unified = await fetchFromBackendUnified(backendUrl);
        const rows = unified ?? (await fetchCombined(origin, cookie, vaultId));
        return tagVault(rows, vaultId);
      }),
    );

    let transactions = perVault.flat();
    transactions.sort((a, b) => (b.timestamp ?? 0) - (a.timestamp ?? 0));

    // Resolve token symbols server-side
    try {
      const { buildTokenIdMap } = await import("@/lib/token-map");
      const tokenMap = await buildTokenIdMap();
      for (const tx of transactions) {
        if (tx.tokenId && !tx.tokenSymbol) {
          tx.tokenSymbol = tokenMap.get(tx.tokenId) ?? tokenMap.get(tx.tokenId?.toLowerCase()) ?? null;
        }
      }
    } catch { /* no symbols */ }

    transactions = transactions.map(normalizeExplorerTransaction);

    return NextResponse.json({ success: true, transactions, count: transactions.length });
  } catch (err) {
    console.error("[Explorer Transactions API] Error:", err);
    return NextResponse.json({ success: true, transactions: [], count: 0 });
  }
}
