/** Return the wallet-owned destination used by the local regtest cash-out UI. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { resolveRegtestRouteConfig } from "@/lib/server/regtest-route-context";
import { applyBackendAuthHeaders } from "@/lib/server/backend-auth";

const exec = promisify(execFile);
const CONTAINER = process.env.REGTEST_FAUCET_DOCKER_CONTAINER || "utxopia-esplora-regtest";
const BCLI = process.env.REGTEST_FAUCET_BITCOIN_CLI || "/srv/explorer/bitcoin/bin/bitcoin-cli";
const BCLI_ARGS = (
  process.env.REGTEST_FAUCET_BCLI_ARGS || "-regtest -datadir=/data/bitcoin -rpcwallet=test"
).split(/\s+/).filter(Boolean);
const LABEL = process.env.REGTEST_REDEMPTION_WALLET_LABEL || "user_redemption";
// Same switch the faucet uses: on a machine running the regtest stack the
// daemon is reachable through the local docker socket; anywhere else — every
// serverless deployment — only the backend sitting beside it can answer.
const MODE = process.env.REGTEST_FAUCET_MODE || (process.env.VERCEL ? "backend" : "local");

async function addressFromBackend(backendUrl: string): Promise<Response> {
  return fetch(`${backendUrl.replace(/\/+$/, "")}/api/regtest/redemption-address`, {
    headers: applyBackendAuthHeaders({}),
    cache: "no-store",
  });
}

async function runBitcoinCli(args: string[]): Promise<string> {
  const { stdout } = await exec("docker", ["exec", CONTAINER, BCLI, ...BCLI_ARGS, ...args], {
    maxBuffer: 1024 * 1024,
  });
  return stdout.trim();
}

async function getWalletAddress(): Promise<string> {
  const configured = process.env.REGTEST_REDEMPTION_ADDRESS?.trim();
  if (configured) return configured;

  try {
    const labelled = JSON.parse(await runBitcoinCli(["getaddressesbylabel", LABEL])) as Record<string, unknown>;
    const existing = Object.keys(labelled)[0];
    if (existing) return existing;
  } catch {
    // Bitcoin Core returns an RPC error when the label does not exist yet.
  }
  return runBitcoinCli(["getnewaddress", LABEL, "bech32m"]);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const routeContext = resolveRegtestRouteConfig(request);
  if ("error" in routeContext) {
    return NextResponse.json({ ok: false, error: routeContext.error }, { status: routeContext.status });
  }

  // A configured address wins everywhere, and needs no daemon at all.
  const preset = process.env.REGTEST_REDEMPTION_ADDRESS?.trim();
  if (preset) {
    return NextResponse.json({ ok: true, address: preset, walletOwned: false });
  }

  if (MODE === "backend") {
    try {
      const upstream = await addressFromBackend(routeContext.config.backend.url);
      const body = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
      return NextResponse.json(body, { status: upstream.status });
    } catch (error) {
      return NextResponse.json(
        {
          ok: false,
          error: `regtest backend unreachable: ${error instanceof Error ? error.message : String(error)}`,
        },
        { status: 502 },
      );
    }
  }

  try {
    const address = await getWalletAddress();
    const info = JSON.parse(await runBitcoinCli(["getaddressinfo", address])) as { ismine?: boolean };
    if (!info.ismine) {
      return NextResponse.json(
        { ok: false, error: "configured regtest redemption address is not owned by the Bitcoin Core wallet" },
        { status: 500 },
      );
    }
    return NextResponse.json({ ok: true, address, walletOwned: true });
  } catch (error) {
    // This route asks a *local* regtest Bitcoin Core for an address by shelling
    // out to `docker exec`. Anywhere without that daemon — every serverless
    // deployment — the spawn fails with ENOENT, and "spawn docker ENOENT" was
    // being rendered verbatim under the address field. It reads as a broken
    // app rather than what it is: a convenience that only exists on a machine
    // running the regtest stack. Set REGTEST_REDEMPTION_ADDRESS to serve one
    // without a node.
    const message = error instanceof Error ? error.message : "";
    // No local docker: fall back to the backend rather than surfacing an errno.
    if (message.includes("ENOENT") || message.includes("Cannot connect to the Docker daemon")) {
      try {
        const upstream = await addressFromBackend(routeContext.config.backend.url);
        const body = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
        return NextResponse.json(body, { status: upstream.status });
      } catch {
        return NextResponse.json(
          {
            ok: false,
            error: "No regtest node reachable — paste a regtest address instead.",
          },
          { status: 503 },
        );
      }
    }
    return NextResponse.json(
      { ok: false, error: message || "could not load regtest wallet address" },
      { status: 500 },
    );
  }
}
