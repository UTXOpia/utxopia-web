/**
 * Sponsored shield: the relayer pays the SOL fee for a shield the user already signed.
 *
 * The client builds the shield transaction with the relayer as fee payer, signs it as token
 * owner, and posts it here. This route is the trust boundary: it only co-signs a transaction
 * that cannot spend anything of the relayer's but the base fee; see `validateSponsoredTx`.
 */
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey, Transaction } from "@solana/web3.js";
import { validateSponsoredTx } from "@/lib/server/sponsored-shield";
import { getRelayerKeypair } from "@/lib/server/relayer";
import { checkRateLimit, getClientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { detectNetworkFromRequest, getNetworkConfig, type NetworkId } from "@/lib/network-config";
import { getVaultNetworkConfig, parseVaultId } from "@/lib/vault-config";
import { networkForChain } from "@/lib/chain-registry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(getClientIp(request.headers), "sol-shield", { maxTokens: 5, windowMs: 60_000 });
  const limited = tooManyRequests(rl);
  if (limited) return limited;

  const relayer = getRelayerKeypair();
  if (!relayer) return NextResponse.json({ error: "sponsored shield not configured" }, { status: 503 });

  const requestedNetwork = request.nextUrl.searchParams.get("network") as NetworkId | null ?? detectNetworkFromRequest(request);
  const solanaNetwork = networkForChain(requestedNetwork, "solana");
  const cfg = getVaultNetworkConfig(solanaNetwork, getNetworkConfig(solanaNetwork), parseVaultId(request.nextUrl.searchParams.get("vault")));
  if (!cfg.solana.utxopiaProgramId) return NextResponse.json({ error: `not configured for network=${solanaNetwork}` }, { status: 400 });

  let tx: Transaction;
  try {
    const { transaction } = await request.json();
    tx = Transaction.from(Buffer.from(String(transaction), "base64"));
  } catch {
    return NextResponse.json({ error: "transaction must be a base64 legacy transaction" }, { status: 400 });
  }
  const problem = validateSponsoredTx(tx, relayer.publicKey, new PublicKey(cfg.solana.utxopiaProgramId));
  if (problem) return NextResponse.json({ error: problem }, { status: 400 });

  const connection = new Connection(cfg.solana.rpcUrl, "confirmed");
  tx.partialSign(relayer);
  // A transaction that fails on chain still charges the fee payer. Simulate first so a
  // stream of doomed shields cannot bleed the relayer under the rate limit.
  const sim = await connection.simulateTransaction(tx);
  if (sim.value.err) return NextResponse.json({ error: "simulation failed", logs: sim.value.logs?.slice(-6) }, { status: 400 });
  try {
    const signature = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    return NextResponse.json({ signature });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message.slice(0, 300) : "send failed" }, { status: 502 });
  }
}
