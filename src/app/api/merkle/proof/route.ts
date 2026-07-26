import { toHex64 } from "@/lib/utils/hex";
import { NextRequest, NextResponse } from "next/server";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  buildCommitmentTreeFromChain,
  getMerkleProofFromTree,
  initPoseidon,
  parseCommitmentTreeData,
  bytesToBigint,
  type CommitmentTreeIndex,
} from "@utxopia/sdk";
import { getTreeProofFromBackend } from "@/lib/api/tree";
import { detectNetworkFromRequest, getNetworkConfig, type NetworkConfig, type NetworkId } from "@/lib/network-config";
export const dynamic = "force-dynamic";

export const runtime = "nodejs";

// =============================================================================
// Poseidon init
// =============================================================================

let poseidonInitialized = false;
let poseidonInitPromise: Promise<void> | null = null;

async function ensurePoseidonInit(): Promise<void> {
  if (poseidonInitialized) return;
  if (poseidonInitPromise) return poseidonInitPromise;
  poseidonInitPromise = initPoseidon().then(() => {
    poseidonInitialized = true;
    console.log("[Merkle Proof API] Poseidon initialized");
  });
  return poseidonInitPromise;
}

// =============================================================================
// Tree cache — avoid rebuilding on every proof request (fallback only)
// =============================================================================

const CACHE_TTL_MS = 30_000; // 30 seconds

interface TreeCacheEntry {
  tree: CommitmentTreeIndex | null;
  onChainRoot: string | null;
  nextIndex: number | null;
  timestamp: number;
  buildPromise: Promise<void> | null;
}

const treeCache = new Map<NetworkId, TreeCacheEntry>();

function cacheForNetwork(network: NetworkId): TreeCacheEntry {
  const existing = treeCache.get(network);
  if (existing) return existing;
  const entry: TreeCacheEntry = {
    tree: null,
    onChainRoot: null,
    nextIndex: null,
    timestamp: 0,
    buildPromise: null,
  };
  treeCache.set(network, entry);
  return entry;
}

async function deriveCommitmentTreePda(programId: string, poolMint: string): Promise<string> {
  const { getProgramDerivedAddress, address, getAddressEncoder } = await import("@solana/kit");
  const encoder = getAddressEncoder();
  const [poolState] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [new TextEncoder().encode("pool_state"), encoder.encode(address(poolMint))],
  });
  const treeIndex = new Uint8Array(4);
  const [pda] = await getProgramDerivedAddress({
    programAddress: address(programId),
    seeds: [
      new TextEncoder().encode("commitment_tree"),
      encoder.encode(poolState),
      treeIndex,
    ],
  });
  return pda;
}

async function getTreeAndRootForNetwork(
  network: NetworkId,
  cfg: NetworkConfig,
): Promise<{
  tree: CommitmentTreeIndex;
  onChainRoot: string;
}> {
  const now = Date.now();
  const cache = cacheForNetwork(network);

  // Return cached if fresh
  if (cache.tree && cache.onChainRoot && now - cache.timestamp < CACHE_TTL_MS) {
    return { tree: cache.tree, onChainRoot: cache.onChainRoot };
  }

  // Deduplicate concurrent builds
  if (cache.buildPromise) {
    await cache.buildPromise;
    if (cache.tree && cache.onChainRoot) {
      return { tree: cache.tree, onChainRoot: cache.onChainRoot };
    }
  }

  cache.buildPromise = (async () => {
    const connection = new Connection(cfg.solana.rpcUrl, "confirmed");
    const commitmentTreePda = new PublicKey(
      await deriveCommitmentTreePda(
        cfg.solana.utxopiaProgramId,
        cfg.tokens.zkbtcMint,
      )
    );

    // Fetch on-chain tree state (root + nextIndex) in one RPC call
    const treeAccountInfo = await connection.getAccountInfo(commitmentTreePda);

    let maxLeafIndex: number | undefined;
    let rootHex: string;

    if (treeAccountInfo) {
      const treeState = parseCommitmentTreeData(new Uint8Array(treeAccountInfo.data));
      maxLeafIndex = Number(treeState.nextIndex);
      rootHex = toHex64(bytesToBigint(treeState.currentRoot));

      // Skip rebuild if nextIndex hasn't changed
      if (cache.tree && cache.nextIndex === maxLeafIndex && cache.onChainRoot) {
        cache.timestamp = now;
        cache.buildPromise = null;
        return;
      }
    } else {
      rootHex = "0".repeat(64);
    }

    // Build tree from chain
    const tree = await buildCommitmentTreeFromChain(
      {
        getProgramAccounts: async (programId, config) => {
          const filters = config?.filters
            ?.map((f: { memcmp?: { offset: number; bytes: string }; dataSize?: number }) => {
              if (f.memcmp) return { memcmp: { offset: f.memcmp.offset, bytes: f.memcmp.bytes } };
              if (f.dataSize !== undefined) return { dataSize: f.dataSize };
              return null;
            })
            .filter((f): f is NonNullable<typeof f> => f !== null);

          const accounts = await connection.getProgramAccounts(
            new PublicKey(programId),
            { filters }
          );
          return accounts.map((acc) => ({
            pubkey: acc.pubkey.toBase58(),
            account: { data: acc.account.data },
          }));
        },
      },
      cfg.solana.utxopiaProgramId,
      maxLeafIndex !== undefined ? { maxLeafIndex } : undefined
    );

    console.log(`[Merkle Proof API] Tree built: ${tree.size()} leaves, root: ${rootHex.slice(0, 16)}...`);

    cache.tree = tree;
    cache.onChainRoot = rootHex;
    cache.nextIndex = maxLeafIndex ?? null;
    cache.timestamp = Date.now();
    cache.buildPromise = null;
  })();

  await cache.buildPromise;

  if (!cache.tree || !cache.onChainRoot) {
    throw new Error("Failed to build commitment tree");
  }

  return { tree: cache.tree, onChainRoot: cache.onChainRoot };
}

// =============================================================================
// Handler
// =============================================================================

/**
 * GET /api/merkle/proof?commitment=xxx
 *
 * Fast path: tries backend's cached tree first (~1ms).
 * Fallback: rebuilds from on-chain data if backend is unavailable (~2-5s).
 */
export async function GET(request: NextRequest) {
  try {
    const commitment = request.nextUrl.searchParams.get("commitment");
    const network = detectNetworkFromRequest(request);

    if (!commitment) {
      return NextResponse.json(
        { success: false, error: "Missing commitment parameter" },
        { status: 400 }
      );
    }

    // Parse commitment to normalize hex
    let commitmentHex: string;
    try {
      if (commitment.startsWith("0x")) {
        commitmentHex = commitment.slice(2);
      } else if (/^[0-9a-fA-F]+$/.test(commitment) && commitment.length >= 32) {
        commitmentHex = commitment;
      } else {
        // Decimal — convert to hex
        commitmentHex = toHex64(BigInt(commitment));
      }
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid commitment format. Use hex (0x...) or decimal." },
        { status: 400 }
      );
    }

    // =========================================================================
    // Fast path: try backend's cached tree first
    // =========================================================================
    const backendResult = await getTreeProofFromBackend(commitmentHex, network);

    if (backendResult?.success) {
      console.log(`[Merkle Proof API] Fast path: proof from backend for leaf ${backendResult.leaf_index}`);
      return NextResponse.json({
        success: true,
        commitment: commitmentHex,
        leafIndex: String(backendResult.leaf_index),
        root: backendResult.root,
        computedRoot: backendResult.root,
        siblings: backendResult.siblings,
        indices: backendResult.indices,
        source: "backend",
      });
    }

    // =========================================================================
    // Fallback: rebuild from on-chain data (trustless)
    // =========================================================================
    console.log("[Merkle Proof API] Backend unavailable, falling back to on-chain rebuild");

    await ensurePoseidonInit();

    let commitmentBigInt: bigint;
    try {
      commitmentBigInt = BigInt("0x" + commitmentHex);
    } catch {
      return NextResponse.json(
        { success: false, error: "Invalid commitment hex" },
        { status: 400 }
      );
    }

    const start = Date.now();
    const cfg = getNetworkConfig(network, { applyEnvOverrides: false });
    const { tree, onChainRoot } = await getTreeAndRootForNetwork(network, cfg);
    const fetchMs = Date.now() - start;

    // Get proof
    const proof = getMerkleProofFromTree(tree, commitmentBigInt);

    if (!proof) {
      const treeData = tree.export();
      return NextResponse.json(
        {
          success: false,
          error: "Commitment not found in on-chain tree",
          treeSize: tree.size(),
          lookingFor: toHex64(commitmentBigInt),
          firstTreeCommitments: treeData.commitments.slice(0, 5).map(([hex]) => hex),
        },
        { status: 404 }
      );
    }

    console.log(`[Merkle Proof API] Fallback: proof for leaf ${proof.leafIndex} in ${fetchMs}ms (${fetchMs < 100 ? "cached" : "rebuilt"})`);

    return NextResponse.json({
      success: true,
      commitment,
      leafIndex: proof.leafIndex.toString(),
      root: onChainRoot,
      computedRoot: toHex64(proof.root),
      siblings: proof.siblings.map((s) => toHex64(s)),
      indices: proof.indices,
      source: "on-chain",
    });
  } catch (error) {
    console.error("[Merkle Proof API] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Failed to get Merkle proof",
      },
      { status: 500 }
    );
  }
}
