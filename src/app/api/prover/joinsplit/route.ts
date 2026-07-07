import { NextRequest } from "next/server";
import type { JoinSplitProofInputs } from "@utxopia/sdk";
import { detectNetworkFromRequest } from "@/lib/network-config";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

type Encoded =
  | null
  | boolean
  | number
  | string
  | Encoded[]
  | { __bigint: string }
  | { [key: string]: Encoded };

function reviveBigints(value: Encoded): unknown {
  if (Array.isArray(value)) return value.map(reviveBigints);
  if (value && typeof value === "object") {
    if ("__bigint" in value && typeof value.__bigint === "string") {
      return BigInt(value.__bigint);
    }
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [key, reviveBigints(item as Encoded)]),
    );
  }
  return value;
}

export async function POST(req: NextRequest) {
  const network = detectNetworkFromRequest(req);
  if (network.includes("mainnet")) {
    return Response.json(
      { success: false, error: "Server prover is disabled on mainnet." },
      { status: 403 },
    );
  }

  try {
    const body = (await req.json()) as { proofInputs?: Encoded };
    if (!body.proofInputs) {
      return Response.json({ success: false, error: "Missing proofInputs" }, { status: 400 });
    }

    (globalThis as { snarkjs?: unknown }).snarkjs ??= await import("snarkjs");

    const {
      initProver,
      generateJoinSplitProof,
      proofToBytes,
      setCircuitPath,
    } = await import("@utxopia/sdk/prover/web");
    const { bytesToHex } = await import("@utxopia/sdk");

    setCircuitPath("./public/circuits/groth16");
    await initProver();

    const proof = await generateJoinSplitProof(
      reviveBigints(body.proofInputs) as JoinSplitProofInputs,
    );

    return Response.json({
      success: true,
      proof,
      proofBytesHex: bytesToHex(proofToBytes(proof)),
    });
  } catch (err) {
    return Response.json(
      {
        success: false,
        error: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
