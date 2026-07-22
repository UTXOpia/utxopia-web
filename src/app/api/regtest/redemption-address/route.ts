/** Return the wallet-owned destination used by the local regtest cash-out UI. */

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { NextRequest, NextResponse } from "next/server";
import { resolveRegtestRouteConfig } from "@/lib/server/regtest-route-context";

const exec = promisify(execFile);
const CONTAINER = process.env.REGTEST_FAUCET_DOCKER_CONTAINER || "utxopia-esplora-regtest";
const BCLI = process.env.REGTEST_FAUCET_BITCOIN_CLI || "/srv/explorer/bitcoin/bin/bitcoin-cli";
const BCLI_ARGS = (
  process.env.REGTEST_FAUCET_BCLI_ARGS || "-regtest -datadir=/data/bitcoin -rpcwallet=test"
).split(/\s+/).filter(Boolean);
const LABEL = process.env.REGTEST_REDEMPTION_WALLET_LABEL || "user_redemption";

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
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : "could not load regtest wallet address" },
      { status: 500 },
    );
  }
}
