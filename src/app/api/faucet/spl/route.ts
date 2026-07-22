/**
 * POST /api/faucet/spl — proxy to the backend SPL faucet.
 *
 * The backend holds the mint-authority key and mints test USDC/USDT to the
 * recipient's public Solana wallet.
 * The web never holds the key — it only forwards, exactly like /api/faucet/regtest.
 */

import { NextResponse } from "next/server";
import { getBackendUrl } from "@/lib/api/constants";
import { detectNetworkFromRequest } from "@/lib/network-config";
import { applyBackendAuthHeaders } from "@/lib/server/backend-auth";

export const dynamic = "force-dynamic";

const API_KEY = process.env.REGTEST_FAUCET_API_KEY;

export async function POST(req: Request) {
  // Optional inbound auth (same gate as the BTC faucet).
  if (API_KEY) {
    const provided = req.headers.get("x-api-key") || req.headers.get("X-API-Key");
    if (provided !== API_KEY) {
      return NextResponse.json({ ok: false, error: "unauthorized" }, { status: 401 });
    }
  }

  let body: { recipient?: string; token?: string; amount?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }
  const recipient = (body.recipient || "").trim();
  const token = (body.token || "").toUpperCase();
  const amount = Number(body.amount);
  if (!recipient || !["USDC", "USDT"].includes(token) || !Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json({ ok: false, error: "require recipient, token (USDC|USDT), amount > 0" }, { status: 400 });
  }

  const network = detectNetworkFromRequest(req);
  const backendUrl = process.env.REGTEST_FAUCET_BACKEND_URL || getBackendUrl(network);
  const headers = applyBackendAuthHeaders({ "Content-Type": "application/json" });

  try {
    const res = await fetch(`${backendUrl}/api/faucet/spl`, {
      method: "POST",
      headers,
      body: JSON.stringify({ recipient, token, amount }),
    });
    const text = await res.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = { ok: false, error: text.slice(0, 300) }; }
    return NextResponse.json(parsed, { status: res.ok ? 200 : res.status });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: `backend SPL faucet unreachable: ${e instanceof Error ? e.message : String(e)}` },
      { status: 502 },
    );
  }
}
