/**
 * Verify API — On-chain SPV deposit verification
 *
 * Triggers btc-light-client verify_transaction + utxopia complete_deposit
 * for a confirmed BTC sweep transaction.
 *
 * Flow:
 * 1. Fetch raw tx hex from mempool.space
 * 2. Upload raw tx to ChadBuffer
 * 3. Build verify_transaction instruction (btc-light-client)
 * 4. Build complete_deposit instruction (utxopia)
 * 5. Submit both in one Solana transaction
 * 6. Close buffer and reclaim rent
 *
 * @module api/verify
 */

import { NextRequest, NextResponse } from "next/server";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  ComputeBudgetProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
const getUTXOpiaSDK = () => import("@utxopia/sdk");

import {
  buildVerifyTransactionInstructionData,
  buildCompleteDepositInstructionData,
} from "@utxopia/sdk";

import {
  derivePoolStatePDA,
  deriveCommitmentTreePDA,
  deriveLightClientPDA,
  derivePoolVaultATA,
  deriveVerifiedTransactionPDA,
  deriveBlockHeaderPDA,
  deriveDepositReceiptPDA,
} from "@/lib/solana/pdas";
import { TOKEN_2022_PROGRAM_ID_STR } from "@/lib/btc-constants";

import { getRelayerKeypair } from "@/lib/server/relayer";
import { checkRateLimit, getClientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { uploadDataToBuffer, closeBuffer } from "@/lib/server/chadbuffer";

import {
  type BlockHeader,
  type MerkleProof,
  reverseBytes,
} from "@/lib/spv/mempool";
// hexToBytes imported lazily via getUTXOpiaSDK()

import {
  buildMerkleProofPath,
} from "@/lib/spv/verify";
import { resolveVerifyConfig } from "@/lib/server/verify-routing";
export const dynamic = "force-dynamic";

// =============================================================================
// Types
// =============================================================================

interface VerifyRequest {
  sweepTxid: string;      // hex display order
  depositTxid: string;    // hex display order (original deposit tx)
  blockHeight: number;
}

interface VerifySuccessResponse {
  success: true;
  signature: string;
  leafIndex?: number;
}

interface VerifyErrorResponse {
  success: false;
  error: string;
}

type VerifyResponse = VerifySuccessResponse | VerifyErrorResponse;

// =============================================================================
// Helpers
// =============================================================================

/**
 * Strip SegWit witness data from a raw transaction.
 * Returns the non-witness serialization (version + inputs + outputs + locktime)
 * whose double-SHA256 equals the txid.
 *
 * If the tx is not SegWit (no marker/flag bytes), returns the original bytes.
 */
function stripWitness(raw: Uint8Array): Uint8Array {
  // SegWit marker = 0x00, flag = 0x01 at bytes [4..6]
  if (raw.length < 6 || raw[4] !== 0x00 || raw[5] !== 0x01) {
    return raw; // not SegWit
  }

  const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
  const result: number[] = [];

  // Version (4 bytes)
  result.push(raw[0], raw[1], raw[2], raw[3]);

  // Skip marker (0x00) and flag (0x01) — start parsing at offset 6
  let offset = 6;

  // Read a compact size (varint)
  function readVarInt(): number {
    const first = raw[offset++];
    if (first < 0xfd) return first;
    if (first === 0xfd) {
      const val = view.getUint16(offset, true);
      offset += 2;
      return val;
    }
    if (first === 0xfe) {
      const val = view.getUint32(offset, true);
      offset += 4;
      return val;
    }
    // 0xff — 8 byte, but unlikely for tx counts
    const lo = view.getUint32(offset, true);
    offset += 8;
    return lo;
  }

  function pushVarInt(n: number) {
    if (n < 0xfd) {
      result.push(n);
    } else if (n <= 0xffff) {
      result.push(0xfd, n & 0xff, (n >> 8) & 0xff);
    } else {
      result.push(0xfe, n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, (n >> 24) & 0xff);
    }
  }

  // Inputs
  const inputCount = readVarInt();
  pushVarInt(inputCount);
  for (let i = 0; i < inputCount; i++) {
    // prevout hash (32) + index (4)
    for (let j = 0; j < 36; j++) result.push(raw[offset++]);
    // scriptSig
    const scriptLen = readVarInt();
    pushVarInt(scriptLen);
    for (let j = 0; j < scriptLen; j++) result.push(raw[offset++]);
    // sequence (4)
    for (let j = 0; j < 4; j++) result.push(raw[offset++]);
  }

  // Outputs
  const outputCount = readVarInt();
  pushVarInt(outputCount);
  for (let i = 0; i < outputCount; i++) {
    // value (8)
    for (let j = 0; j < 8; j++) result.push(raw[offset++]);
    // scriptPubKey
    const scriptLen = readVarInt();
    pushVarInt(scriptLen);
    for (let j = 0; j < scriptLen; j++) result.push(raw[offset++]);
  }

  // Skip witness data — jump to locktime (last 4 bytes)
  const locktime = raw.slice(raw.length - 4);
  result.push(locktime[0], locktime[1], locktime[2], locktime[3]);

  return new Uint8Array(result);
}

/**
 * Fetch raw transaction hex from mempool.space
 */
async function fetchRawTxHex(txid: string, esploraApiUrl: string): Promise<string> {
  const resp = await fetch(`${esploraApiUrl}/tx/${txid}/hex`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch raw tx: ${resp.status} ${resp.statusText}`);
  }
  return resp.text();
}

async function fetchMerkleProof(txid: string, esploraApiUrl: string): Promise<MerkleProof> {
  const resp = await fetch(`${esploraApiUrl}/tx/${txid}/merkle-proof`);
  if (!resp.ok) {
    throw new Error(`Failed to fetch merkle proof: ${resp.status} ${resp.statusText}`);
  }
  const proof = await resp.json() as { block_height: number; pos: number; merkle: string[] };
  return {
    blockHeight: proof.block_height,
    blockHash: "",
    txIndex: proof.pos,
    merkleProof: proof.merkle,
  };
}

async function fetchBlockHeaderByHeight(height: number, esploraApiUrl: string): Promise<BlockHeader> {
  const hashResp = await fetch(`${esploraApiUrl}/block-height/${height}`);
  if (!hashResp.ok) {
    throw new Error(`Failed to fetch block hash: ${hashResp.status} ${hashResp.statusText}`);
  }
  const blockHash = (await hashResp.text()).trim();

  const blockResp = await fetch(`${esploraApiUrl}/block/${blockHash}`);
  if (!blockResp.ok) {
    throw new Error(`Failed to fetch block: ${blockResp.status} ${blockResp.statusText}`);
  }
  const blockInfo = await blockResp.json() as {
    height: number;
    version: number;
    previousblockhash: string;
    merkle_root: string;
    timestamp: number;
    bits: number;
    nonce: number;
  };

  const headerResp = await fetch(`${esploraApiUrl}/block/${blockHash}/header`);
  if (!headerResp.ok) {
    throw new Error(`Failed to fetch block header: ${headerResp.status} ${headerResp.statusText}`);
  }

  return {
    height: blockInfo.height,
    hash: blockHash,
    version: blockInfo.version,
    previousBlockHash: blockInfo.previousblockhash,
    merkleRoot: blockInfo.merkle_root,
    timestamp: blockInfo.timestamp,
    bits: blockInfo.bits,
    nonce: blockInfo.nonce,
    rawHeader: (await headerResp.text()).trim(),
  };
}

// =============================================================================
// Main Handler
// =============================================================================

export async function POST(request: NextRequest): Promise<NextResponse<VerifyResponse>> {
  // Rate limit: 5 verify requests per minute per IP (each costs SOL)
  const rl = checkRateLimit(getClientIp(request.headers), "verify", { maxTokens: 5, windowMs: 60_000 });
  const limited = tooManyRequests(rl, 12000);
  if (limited) return limited as NextResponse<VerifyResponse>;

  const startTime = Date.now();
  const { hexToBytes } = await getUTXOpiaSDK();
  const spvHexToBytes = hexToBytes;

  try {
    const verifyContext = resolveVerifyConfig(request);
    if ("error" in verifyContext) {
      return NextResponse.json(
        { success: false, error: verifyContext.error },
        { status: verifyContext.status },
      );
    }

    const body: VerifyRequest = await request.json();
    const { sweepTxid, depositTxid, blockHeight } = body;

    if (!sweepTxid || !depositTxid || !blockHeight) {
      return NextResponse.json(
        { success: false, error: "Missing required fields (sweepTxid, depositTxid, blockHeight)" },
        { status: 400 }
      );
    }

    // Validate before any network/chain interaction: txids must be 64 hex chars
    // and blockHeight a sane positive integer. Prevents path injection into the
    // Esplora URLs and relayer spend on malformed input.
    const TXID_RE = /^[0-9a-fA-F]{64}$/;
    if (!TXID_RE.test(sweepTxid) || !TXID_RE.test(depositTxid)) {
      return NextResponse.json(
        { success: false, error: "sweepTxid and depositTxid must be 64 hex characters" },
        { status: 400 }
      );
    }
    if (!Number.isInteger(blockHeight) || blockHeight <= 0 || blockHeight > 10_000_000) {
      return NextResponse.json(
        { success: false, error: "blockHeight must be a positive integer" },
        { status: 400 }
      );
    }

    console.log(`[Verify] Processing deposit verification for sweep: ${sweepTxid}, deposit: ${depositTxid}`);

    const relayer = getRelayerKeypair();
    if (!relayer) {
      return NextResponse.json(
        { success: false, error: "Relayer not configured — RELAYER_KEYPAIR env var is missing" },
        { status: 503 }
      );
    }

    const connection = new Connection(
      verifyContext.config.solana.rpcUrl,
      "confirmed"
    );
    const utxopiaProgramId = new PublicKey(verifyContext.config.solana.utxopiaProgramId);
    const btcLightClientProgramId = new PublicKey(verifyContext.config.solana.btcLightClientId);
    const chadbufferProgramId = new PublicKey(verifyContext.config.solana.chadbufferId);
    const zkbtcMint = new PublicKey(verifyContext.config.tokens.zkbtcMint);
    const token2022ProgramId = new PublicKey(TOKEN_2022_PROGRAM_ID_STR);

    // 1. Fetch raw tx hex from mempool.space and strip SegWit witness data
    console.log(`[Verify] Fetching raw transactions on ${verifyContext.bitcoinNetwork} via ${verifyContext.esploraApiUrl}...`);
    const [sweepRawHex, depositRawHex] = await Promise.all([
      fetchRawTxHex(sweepTxid, verifyContext.esploraApiUrl),
      fetchRawTxHex(depositTxid, verifyContext.esploraApiUrl),
    ]);
    const sweepFullBytes = hexToBytes(sweepRawHex);
    const depositFullBytes = hexToBytes(depositRawHex);
    const sweepRawBytes = stripWitness(sweepFullBytes);
    const depositRawBytes = stripWitness(depositFullBytes);
    console.log(`[Verify] Sweep: ${sweepFullBytes.length}→${sweepRawBytes.length} bytes, Deposit: ${depositFullBytes.length}→${depositRawBytes.length} bytes`);

    // 2. Fetch Merkle proof from mempool.space
    console.log("[Verify] Fetching Merkle proof...");
    const merkleProof = await fetchMerkleProof(sweepTxid, verifyContext.esploraApiUrl);

    // 3. Fetch block header to get block hash
    console.log("[Verify] Fetching block header...");
    const blockHeader = await fetchBlockHeaderByHeight(blockHeight, verifyContext.esploraApiUrl);

    // Convert txids and block hash to internal byte order (reversed)
    const sweepTxidInternal = reverseBytes(spvHexToBytes(sweepTxid));
    const depositTxidInternal = reverseBytes(spvHexToBytes(depositTxid));
    const blockHashInternal = reverseBytes(spvHexToBytes(blockHeader.hash));

    // 4. Upload raw txs to ChadBuffer accounts
    const [sweepBuffer, depositBuffer] = await Promise.all([
      uploadDataToBuffer(connection, relayer, sweepRawBytes, chadbufferProgramId, "Verify"),
      uploadDataToBuffer(connection, relayer, depositRawBytes, chadbufferProgramId, "Verify"),
    ]);

    // Reclaim buffer rent on BOTH success and failure (the SPV/complete tx below
    // can reject after the buffers are funded).
    const closeBuffers = async () => {
      try {
        await Promise.all([
          closeBuffer(connection, relayer, sweepBuffer.bufferPubkey, chadbufferProgramId, "Verify"),
          closeBuffer(connection, relayer, depositBuffer.bufferPubkey, chadbufferProgramId, "Verify"),
        ]);
      } catch (closeErr) {
        console.warn("[Verify] Failed to close buffer (non-critical):", closeErr);
      }
    };

    try {
    // 5. Derive all PDAs. Seed the pool from this network's mint rather than
    // letting it default: the default reads the SDK config, and `initConfig`
    // only ever runs in the browser (chain-environment.ts), so on the server it
    // resolves to a mint that was never deployed — a pool whose PDAs do not
    // exist, which the program rejects as a bad account owner.
    const [poolStatePDA] = derivePoolStatePDA(utxopiaProgramId, zkbtcMint);
    const [commitmentTreePDA] = deriveCommitmentTreePDA(utxopiaProgramId, 0, poolStatePDA);
    const [lightClientPDA] = deriveLightClientPDA(btcLightClientProgramId);
    const poolVaultATA = derivePoolVaultATA(utxopiaProgramId, zkbtcMint, token2022ProgramId, poolStatePDA);
    // Active complete_deposit (disc 11) flow keys the receipt by txid only (web-local helper).
    const [depositReceiptPDA] = deriveDepositReceiptPDA(depositTxidInternal, utxopiaProgramId);

    // Block header PDA: derive from block hash
    const [blockHeaderPDA] = deriveBlockHeaderPDA(blockHashInternal, btcLightClientProgramId);

    const [verifiedTxPDA] = deriveVerifiedTransactionPDA(blockHashInternal, sweepTxidInternal, btcLightClientProgramId);

    // 6. Build merkle proof data for verify_transaction
    const merkleSiblings = merkleProof.merkleProof.map((hash) =>
      reverseBytes(spvHexToBytes(hash))
    );
    const pathBits = buildPathBits(merkleProof.txIndex, merkleSiblings.length);

    const verifyTxData = buildVerifyTransactionInstructionData({
      txid: sweepTxidInternal,
      blockHash: blockHashInternal,
      txSize: sweepRawBytes.length,
      txIndex: merkleProof.txIndex,
      merkleSiblings,
      pathBits,
    });

    const verifyTxIx = new TransactionInstruction({
      programId: btcLightClientProgramId,
      keys: [
        { pubkey: verifiedTxPDA, isSigner: false, isWritable: true },
        { pubkey: lightClientPDA, isSigner: false, isWritable: false },
        { pubkey: blockHeaderPDA, isSigner: false, isWritable: false },
        { pubkey: sweepBuffer.bufferPubkey, isSigner: false, isWritable: false },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      ],
      data: Buffer.from(verifyTxData),
    });

    // 7. Build complete_deposit instruction
    const completeDepositData = buildCompleteDepositInstructionData({
      sweepTxid: sweepTxidInternal,
      blockHeight,
      sweepTxSize: sweepRawBytes.length,
      depositTxSize: depositRawBytes.length,
      depositTxid: depositTxidInternal,
    });

    const verifyDepositIx = new TransactionInstruction({
      programId: utxopiaProgramId,
      keys: [
        { pubkey: poolStatePDA, isSigner: false, isWritable: true },
        { pubkey: verifiedTxPDA, isSigner: false, isWritable: false },
        { pubkey: lightClientPDA, isSigner: false, isWritable: false },
        { pubkey: commitmentTreePDA, isSigner: false, isWritable: true },
        { pubkey: sweepBuffer.bufferPubkey, isSigner: false, isWritable: false },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: zkbtcMint, isSigner: false, isWritable: true },
        { pubkey: poolVaultATA, isSigner: false, isWritable: true },
        { pubkey: token2022ProgramId, isSigner: false, isWritable: false },
        { pubkey: depositBuffer.bufferPubkey, isSigner: false, isWritable: false },
        { pubkey: depositReceiptPDA, isSigner: false, isWritable: true },
      ],
      data: Buffer.from(completeDepositData),
    });

    // 8. Submit both instructions in one transaction
    console.log("[Verify] Submitting verification transaction...");

    const { blockhash } = await connection.getLatestBlockhash();
    const tx = new Transaction();
    tx.add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      verifyTxIx,
      verifyDepositIx
    );
    tx.feePayer = relayer.publicKey;
    tx.recentBlockhash = blockhash;

    const signature = await sendAndConfirmTransaction(connection, tx, [relayer], {
      commitment: "confirmed",
    });

    console.log(`[Verify] Transaction confirmed: ${signature}`);

    // 9. Close buffers
    await closeBuffers();

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Verify] Complete in ${duration}s`);

    return NextResponse.json({
      success: true,
      signature,
    });
    } catch (innerErr) {
      await closeBuffers();
      throw innerErr;
    }
  } catch (error) {
    console.error("[Verify] Error:", error);
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * Build path_bits bitmask from tx_index.
 * Bit i = 1 means the sibling is on the LEFT at level i (i.e., current node is on the right).
 */
function buildPathBits(txIndex: number, depth: number): number {
  let bits = 0;
  let index = txIndex;
  for (let i = 0; i < depth; i++) {
    if ((index & 1) === 1) {
      bits |= 1 << i;
    }
    index = index >> 1;
  }
  return bits;
}
