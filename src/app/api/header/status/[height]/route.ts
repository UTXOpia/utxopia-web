import { NextRequest, NextResponse } from "next/server";
import { detectNetworkFromRequest, getNetworkConfig, networkChain } from "@/lib/network-config";
const getSolanaKit = () => import("@solana/kit");
export const dynamic = "force-dynamic";

export const runtime = "nodejs";

// Derive height index PDA using @solana/kit (checks canonical block at height)
async function deriveHeightIndexPDA(blockHeight: number, btcLightClientId: string): Promise<string> {
  const heightBuffer = new Uint8Array(8);
  const view = new DataView(heightBuffer.buffer);
  view.setBigUint64(0, BigInt(blockHeight), true);

  const { getProgramDerivedAddress, address } = await getSolanaKit();
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(btcLightClientId),
    seeds: [new TextEncoder().encode("height_index"), heightBuffer],
  });

  return pda;
}

async function fetchAccountInfoFromRpc(
  rpcUrl: string,
  accountAddress: string,
): Promise<{ data: Uint8Array; lamports: bigint } | null> {
  const { createSolanaRpc } = await getSolanaKit();
  const rpc = createSolanaRpc(rpcUrl);
  const result = await rpc.getAccountInfo(accountAddress as Parameters<typeof rpc.getAccountInfo>[0], {
    encoding: "base64",
  }).send();

  if (!result.value) return null;

  const data = typeof result.value.data === "string"
    ? Uint8Array.from(atob(result.value.data), c => c.charCodeAt(0))
    : result.value.data[0]
      ? Uint8Array.from(atob(result.value.data[0]), c => c.charCodeAt(0))
      : new Uint8Array();

  return {
    data,
    lamports: result.value.lamports,
  };
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ height: string }> }
) {
  try {
    const { height } = await params;

    // Validate input length to prevent DoS
    if (!height || height.length > 10) {
      return NextResponse.json(
        { exists: false, error: "Invalid block height" },
        { status: 400 }
      );
    }

    const blockHeight = parseInt(height, 10);

    // Validate block height range (0 to max reasonable Bitcoin block height)
    // Bitcoin block time ~10 min, so max ~50M blocks in 1000 years
    const MAX_BLOCK_HEIGHT = 100_000_000;
    if (isNaN(blockHeight) || blockHeight < 0 || blockHeight > MAX_BLOCK_HEIGHT) {
      return NextResponse.json(
        { exists: false, error: "Invalid block height" },
        { status: 400 }
      );
    }

    const network = detectNetworkFromRequest(request);
    if (networkChain(network) !== "sol") {
      return NextResponse.json(
        { exists: false, error: "Header status is only available for Solana networks" },
        { status: 400 }
      );
    }
    const cfg = getNetworkConfig(network, { applyEnvOverrides: false });
    if (!cfg.solana.btcLightClientId || !cfg.solana.rpcUrl) {
      return NextResponse.json(
        { exists: false, error: `Solana BTC light client is not configured for network=${network}` },
        { status: 400 }
      );
    }

    // Derive PDA and check if header exists using @solana/kit
    const headerPDA = await deriveHeightIndexPDA(blockHeight, cfg.solana.btcLightClientId);
    const accountInfo = await fetchAccountInfoFromRpc(cfg.solana.rpcUrl, headerPDA);

    if (accountInfo) {
      return NextResponse.json({
        exists: true,
        block_height: blockHeight,
        // Could parse account data here to get more info
      });
    }

    return NextResponse.json({
      exists: false,
      block_height: blockHeight,
    });
  } catch (error) {
    console.error("[Header Status API] Error:", error);
    return NextResponse.json(
      {
        exists: false,
        error: error instanceof Error ? error.message : "Internal server error",
      },
      { status: 500 }
    );
  }
}
