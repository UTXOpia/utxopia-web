/** POST /api/faucet/btc — send native regtest BTC to a user-supplied wallet. */

import { NextResponse } from "next/server";
import { getBackendUrl } from "@/lib/api/constants";
import { detectNetworkFromRequest, getNetworkConfig } from "@/lib/network-config";
import { applyBackendAuthHeaders } from "@/lib/server/backend-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  let body: { address?: string; amountSats?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const network = detectNetworkFromRequest(req);
  const config = getNetworkConfig(network, { applyEnvOverrides: false });
  if (config.bitcoin.network !== "regtest") {
    return NextResponse.json({ ok: false, error: "native BTC faucet is regtest-only" }, { status: 400 });
  }

  const address = (body.address || "").trim();
  const amountSats = Number(body.amountSats);
  if (!/^bcrt1[0-9a-z]{38,90}$/.test(address)) {
    return NextResponse.json({ ok: false, error: "enter a valid regtest BTC address" }, { status: 400 });
  }
  if (!Number.isInteger(amountSats) || amountSats <= 0 || amountSats > 100_000) {
    return NextResponse.json({ ok: false, error: "amount must be 1–100,000 sats" }, { status: 400 });
  }

  const backendUrl = process.env.REGTEST_FAUCET_BACKEND_URL || getBackendUrl(network);
  try {
    const response = await fetch(`${backendUrl}/api/faucet/regtest`, {
      method: "POST",
      headers: applyBackendAuthHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({ asset: "BTC", address, amountSats }),
      cache: "no-store",
    });
    const text = await response.text();
    let parsed: unknown;
    try { parsed = JSON.parse(text); } catch { parsed = { ok: false, error: text.slice(0, 300) }; }
    return NextResponse.json(parsed, { status: response.status });
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: `backend BTC faucet unreachable: ${error instanceof Error ? error.message : String(error)}` },
      { status: 502 },
    );
  }
}
