import { NextRequest, NextResponse } from "next/server";
import { PublicKey } from "@solana/web3.js";
import { detectNetworkFromRequest, getNetworkConfig } from "@/lib/network-config";
import { getHeliusRpcUrl } from "@/lib/helius-server";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

async function fetchBalanceFromRpc(rpcUrl: string, owner: string, mint: string): Promise<bigint> {
  const rpcResponse = await fetch(rpcUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "getTokenAccountsByOwner",
      params: [
        owner,
        { mint },
        { encoding: "jsonParsed", commitment: "confirmed" },
      ],
    }),
    cache: "no-store",
    signal: AbortSignal.timeout(8_000),
  });

  if (!rpcResponse.ok) {
    throw new Error(`RPC request failed with ${rpcResponse.status}`);
  }

  const result = await rpcResponse.json();
  if (result?.error) {
    throw new Error(result.error.message || "RPC returned an error");
  }

  const accounts = result?.result?.value ?? [];
  let total = 0n;
  for (const account of accounts) {
    const amount = account?.account?.data?.parsed?.info?.tokenAmount?.amount;
    if (typeof amount === "string") total += BigInt(amount);
  }
  return total;
}

export async function GET(request: NextRequest) {
  const owner = request.nextUrl.searchParams.get("owner");

  if (!owner) {
    return NextResponse.json(
      { error: "Missing owner public key" },
      { status: 400 }
    );
  }

  try {
    const ownerPubkey = new PublicKey(owner);
    const network = detectNetworkFromRequest(request);
    const { solana, tokens } = getNetworkConfig(network, { applyEnvOverrides: false });

    const serverRpc = network === "localnet"
      ? solana.rpcUrl
      : getHeliusRpcUrl(network === "mainnet" ? "mainnet" : "devnet");
    const rpcUrls = Array.from(new Set([serverRpc, solana.rpcUrl].filter(Boolean)));
    let lastError: unknown;

    for (const rpcUrl of rpcUrls) {
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          const total = await fetchBalanceFromRpc(
            rpcUrl,
            ownerPubkey.toBase58(),
            tokens.zkbtcMint,
          );
          return NextResponse.json({ amount: total.toString() });
        } catch (error) {
          lastError = error;
          if (attempt === 0) {
            await new Promise((resolve) => setTimeout(resolve, 150));
          }
        }
      }
    }

    return NextResponse.json(
      {
        error: lastError instanceof Error
          ? lastError.message
          : "All balance RPC requests failed",
      },
      { status: 502 },
    );
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error ? error.message : "Failed to fetch public balance",
      },
      { status: 500 }
    );
  }
}
