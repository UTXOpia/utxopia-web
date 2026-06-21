// In-app Sui faucet for the XUSD demo coin (on-chain ::dusd::DUSD, displayed as XUSD).
// Mints XUSD straight to the user's wallet via the coin TreasuryCap, signed by the relayer
// (which owns the cap) — no external captcha, unlike SUI/USDC which use external faucets.
import { NextRequest, NextResponse } from "next/server";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Transaction } from "@mysten/sui/transactions";
import { checkRateLimit, getClientIp } from "@/lib/server/rate-limit";
import { getSuiRelayerKeypair } from "@/lib/server/sui-relayer";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// XUSD = the ::dusd::DUSD demo coin (9 decimals). Cap is owned by the relayer.
const XUSD_COIN_TYPE =
  process.env.UTXOPIA_SUI_XUSD_COIN_TYPE ??
  "0x2e290a13f3e33724921b5ce1cc90aa8fb6736abefcda46e72fdaf874a05756a8::dusd::DUSD";
const XUSD_TREASURY_CAP =
  process.env.UTXOPIA_SUI_XUSD_TREASURY_CAP ??
  "0x5debf14a0d0bc25482d842b1e564df70c9de280585b1f49640f68ee2ef5f0ab0";
const XUSD_DECIMALS = 9n;
const MAX_XUSD = 1000;
const ADDRESS_RE = /^0x[0-9a-fA-F]{64}$/;

function jsonError(message: string, status: number) {
  return NextResponse.json({ success: false, error: message }, { status });
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rl = checkRateLimit(ip, "sui-xusd-faucet", { maxTokens: 5, windowMs: 60_000 });
  if (rl.limited) return jsonError("Too many faucet requests. Try again shortly.", 429);

  let body: { recipient?: string; amount?: number };
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body.", 400);
  }

  const recipient = (body.recipient ?? "").trim();
  if (!ADDRESS_RE.test(recipient)) return jsonError("Invalid Sui address.", 400);
  const amount = Math.floor(Number(body.amount ?? 100));
  if (!Number.isFinite(amount) || amount <= 0) return jsonError("Amount must be positive.", 400);
  if (amount > MAX_XUSD) return jsonError(`Max ${MAX_XUSD} XUSD per request.`, 400);

  try {
    const rpcUrl =
      process.env.UTXOPIA_SUI_RPC_URL ||
      process.env.NEXT_PUBLIC_SUI_RPC_URL ||
      "https://fullnode.testnet.sui.io:443";
    const client = new SuiJsonRpcClient({ url: rpcUrl, network: "testnet" });
    const signer = getSuiRelayerKeypair();

    const baseUnits = BigInt(amount) * 10n ** XUSD_DECIMALS;
    const tx = new Transaction();
    tx.moveCall({
      target: "0x2::coin::mint_and_transfer",
      typeArguments: [XUSD_COIN_TYPE],
      arguments: [tx.object(XUSD_TREASURY_CAP), tx.pure.u64(baseUnits.toString()), tx.pure.address(recipient)],
    });
    tx.setSender(signer.toSuiAddress());
    tx.setGasBudget(BigInt(process.env.UTXOPIA_SUI_GAS_BUDGET ?? "100000000"));

    const result = await client.signAndExecuteTransaction({
      signer,
      transaction: tx,
      options: { showEffects: true },
    });
    await client.waitForTransaction({ digest: result.digest, options: { showEffects: true } });
    if (result.effects?.status?.status === "failure") {
      throw new Error(result.effects.status.error || "XUSD mint failed");
    }
    return NextResponse.json({ success: true, digest: result.digest, amount, symbol: "XUSD" });
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not mint XUSD.", 500);
  }
}
