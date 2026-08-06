/**
 * Solana Proof Relay API
 *
 * Chain-specific endpoint for Solana JoinSplit modes:
 * - mode="transfer" → TRANSACT (disc=13) — private transfer
 * - mode="unshield" → UNSHIELD (disc=14) — public withdrawal to SPL token or native SOL
 * - mode="redeem"   → REDEEM (disc=15)   — atomic JoinSplit + BTC withdrawal (multi-output)
 *
 * Flow:
 * 1. Client generates JoinSplit proof locally
 * 2. Client sends proof + params + mode to this API
 * 3. Backend uploads proof to ChadBuffer
 * 4. Backend builds instruction data via SDK (per mode)
 * 5. Backend submits transaction and closes buffer
 *
 * @module api/sol/relay
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
import {
  createAssociatedTokenAccountIdempotentInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
const getUTXOpiaSDK = () => import("@utxopia/sdk");

import {
  deriveNullifierPDA,
  deriveVkRegistryPDA,
  deriveTokenConfigPDA,
  deriveRedemptionRequestPDA as deriveSyncRedemptionRequestPDA,
} from "@/lib/solana/pdas";

import { getRelayerKeypair as getRelayerKeypairShared } from "@/lib/server/relayer";
import { checkRateLimit, getClientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { uploadDataToBuffer, closeBuffer } from "@/lib/server/chadbuffer";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  type NetworkId,
} from "@/lib/network-config";
import {
  getVaultNetworkConfig,
  parseVaultId,
} from "@/lib/vault-config";
import { networkForChain } from "@/lib/chain-registry";
import { isNativeSolMint } from "@/lib/solana/native-sol";
import { resolvePolicyApproval } from "@/lib/server/policy-coordinator";
import { resolveRegisteredExits } from "@/lib/server/exit-registry";
export const dynamic = "force-dynamic";

// =============================================================================
// Configuration
// =============================================================================

const RELAYER_FEE_SATS = parseInt(process.env.RELAYER_FEE_SATS || "2000", 10);

// =============================================================================
// Types
// =============================================================================

interface RelayRequest {
  /** "transfer" | "unshield" | "redeem" */
  mode: "transfer" | "unshield" | "redeem";
  nInputs: number;
  nOutputs: number;
  proof: string;
  merkleRoot: string;
  boundParamsHash: string;
  nullifiers: string[];
  commitmentsOut: string[];
  stealthData: string[];
  /** Transfer: index of relayer fee output */
  relayerFeeOutputIndex?: number;
  /** Unshield: amounts in satoshis (one per public output) */
  unshieldAmounts?: string[];
  /** Unshield: recipient Solana addresses (base58, one per public output) */
  recipientAddresses?: string[];
  /** Unshield: optional pre-derived SPL recipient token accounts */
  recipientTokenAccounts?: string[];
  /** Redeem: amounts in satoshis (one per public output) */
  redeemAmounts?: string[];
  /** Redeem: Bitcoin scriptPubKeys (hex, one per public output) */
  btcScripts?: string[];
  /** Redeem: unique request nonces (one per public output) */
  requestNonces?: string[];
  /** Reserved; rejected until sender memos are proof-bound. */
  senderMemos?: string[];
  /**
   * Optional frozen source-tree PDA (base58). Only set when a spent note was committed in a
   * PREVIOUS commitment tree that was rotated out (active_tree_index advanced past it). The
   * on-chain program proves membership against this tree while inserting new outputs into the
   * active tree. Inserted just before the proof buffer so it matches the program's positional
   * detection. Omit for the common case (note in the active tree) — strictly no-op then.
   */
  sourceTree?: string;
  /** Opaque backend policy request handle for Verified Privacy. */
  policyRequestId?: string;
}

// =============================================================================
// Helpers
// =============================================================================

function getRelayerKeypair(): Keypair {
  // Try shared helper first (used by unshield/redeem), fall back to env parsing
  const shared = getRelayerKeypairShared();
  if (shared) return shared;
  const keypairJson = process.env.RELAYER_KEYPAIR;
  if (!keypairJson) throw new Error("RELAYER_KEYPAIR not configured");
  const secretKey = JSON.parse(keypairJson);
  return Keypair.fromSecretKey(Uint8Array.from(secretKey));
}

function validateHexField(
  hexToBytes: (hex: string) => Uint8Array,
  value: string | undefined,
  name: string,
  expectedBytes: number,
): Uint8Array {
  if (!value) throw new Error(`Missing required field: ${name}`);
  const bytes = hexToBytes(value);
  if (bytes.length !== expectedBytes) {
    throw new Error(`Invalid ${name}: expected ${expectedBytes} bytes, got ${bytes.length}`);
  }
  return bytes;
}

function deriveRedemptionRequestPDA(
  user: PublicKey,
  nonce: bigint,
  programId: PublicKey,
  poolState: PublicKey,
): [PublicKey, number] {
  return deriveSyncRedemptionRequestPDA(user, nonce, programId, poolState);
}

// =============================================================================
// Main Handler
// =============================================================================

/**
 * GET /api/sol/relay — returns the relayer's Solana pubkey.
 *
 * The redeem proof binds `requester = accounts[3]`, which is this relayer (the redeem signer).
 * The client must bind the same pubkey into its bound-params hash at proof time, so it fetches
 * it here first.
 */
export async function GET() {
  try {
    const relayer = getRelayerKeypair();
    return NextResponse.json({ relayerPubkey: relayer.publicKey.toBase58() });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "relayer not configured" },
      { status: 500 },
    );
  }
}

export async function POST(request: NextRequest) {
  // Rate limit: 10 relay requests per minute per IP
  const rl = checkRateLimit(getClientIp(request.headers), "relay", { maxTokens: 10, windowMs: 60_000 });
  const limited = tooManyRequests(rl);
  if (limited) return limited;

  const startTime = Date.now();

  try {
    const requestedNetwork = request.nextUrl.searchParams.get("network") as NetworkId | null
      ?? detectNetworkFromRequest(request);
    const solanaNetwork = networkForChain(requestedNetwork, "solana");
    const vaultId = parseVaultId(request.nextUrl.searchParams.get("vault"));
    const cfg = getVaultNetworkConfig(
      solanaNetwork,
      getNetworkConfig(solanaNetwork),
      vaultId,
    );
    if (!cfg.solana.utxopiaProgramId || !cfg.tokens.zkbtcMint || !cfg.solana.chadbufferId) {
      return NextResponse.json(
        { success: false, error: `Solana relay is not configured for network=${solanaNetwork}` },
        { status: 400 },
      );
    }

    const {
      hexToBytes,
      buildTransactInstructionData,
      buildUnshieldInstructionData,
      buildRedeemInstructionData,
    } = await getUTXOpiaSDK();

    const body: RelayRequest = await request.json();
    const { mode = "transfer" } = body;
    const { nInputs, nOutputs, proof, merkleRoot, boundParamsHash, nullifiers, commitmentsOut, stealthData } = body;
    // Optional frozen source tree (pre-rotation note membership). Inserted just before the proof
    // buffer in every mode so it matches the on-chain positional detection (account at len-1-pb).
    const sourceTreeKey = body.sourceTree ? new PublicKey(body.sourceTree) : null;

    // ── Common validation ──────────────────────────────────────────────
    if (
      nInputs == null || nOutputs == null || !proof || !merkleRoot ||
      !boundParamsHash || !nullifiers || !commitmentsOut || !stealthData
    ) {
      return NextResponse.json({ success: false, error: "Missing required fields" }, { status: 400 });
    }
    if (!Number.isInteger(nInputs) || !Number.isInteger(nOutputs) || nInputs < 1 || nOutputs < 1 || nInputs > 14 || nOutputs > 14) {
      return NextResponse.json({ success: false, error: "Invalid circuit dimensions" }, { status: 400 });
    }
    if (nullifiers.length !== nInputs) {
      return NextResponse.json({ success: false, error: `Expected ${nInputs} nullifiers, got ${nullifiers.length}` }, { status: 400 });
    }

    // Stealth data count: nOutputs for transfer, nOutputs-1 for unshield/redeem
    const expectedStealthCount = mode === "transfer" ? nOutputs : nOutputs - 1;
    if (stealthData.length !== expectedStealthCount) {
      return NextResponse.json({ success: false, error: `Expected ${expectedStealthCount} stealth data entries, got ${stealthData.length}` }, { status: 400 });
    }
    if (commitmentsOut.length !== nOutputs) {
      return NextResponse.json({ success: false, error: `Expected ${nOutputs} commitments, got ${commitmentsOut.length}` }, { status: 400 });
    }

    console.log(`[Relay] Processing Solana ${mode} JoinSplit(${nInputs}x${nOutputs}) on ${solanaNetwork}...`);

    const relayer = getRelayerKeypair();
    // Asset state always settles directly on Solana. PER is deliberately kept
    // out of the commitment-tree/nullifier path and is used only by separate
    // policy and coordination services.
    const connection = new Connection(cfg.solana.rpcUrl, "confirmed");
    const programId = new PublicKey(cfg.solana.utxopiaProgramId);
    const chadbufferProgramId = new PublicKey(cfg.solana.chadbufferId);
    const zkbtcMint = new PublicKey(cfg.tokens.zkbtcMint);

    // ── Parse common hex fields ────────────────────────────────────────
    const proofBytes = validateHexField(hexToBytes, proof, "proof", 256);
    const merkleRootBytes = validateHexField(hexToBytes, merkleRoot, "merkleRoot", 32);
    const boundParamsHashBytes = validateHexField(hexToBytes, boundParamsHash, "boundParamsHash", 32);
    const nullifierBytes = nullifiers.map((n, i) => validateHexField(hexToBytes, n, `nullifiers[${i}]`, 32));
    const commitmentBytes = commitmentsOut.map((c, i) => validateHexField(hexToBytes, c, `commitmentsOut[${i}]`, 32));

    // Stealth data: all JoinSplit modes use 72-byte envelopes.
    const stealthDataBytes = stealthData.map((s, i) => {
      const bytes = hexToBytes(s);
      if (bytes.length !== 72) throw new Error(`stealthData[${i}]: expected 72 bytes, got ${bytes.length}`);
      return bytes;
    });

    // ── Derive common PDAs ─────────────────────────────────────────────
    const poolState = new PublicKey(cfg.solana.poolState!);
    const nullifierPDAs = nullifierBytes.map(
      (n) => deriveNullifierPDA(n, poolState, 0, programId)[0]
    );
    const [vkRegistryPDA] = deriveVkRegistryPDA(nInputs, nOutputs, programId);
    const commitmentTree = new PublicKey(cfg.solana.commitmentTree!);
    // ── Relayer fee check (transfer mode only) ─────────────────────────
    if (mode === "transfer" && RELAYER_FEE_SATS > 0) {
      const feeIdx = body.relayerFeeOutputIndex;
      if (feeIdx == null || feeIdx < 0 || feeIdx >= nOutputs) {
        return NextResponse.json(
          { success: false, error: `Relayer fee output index required (RELAYER_FEE_SATS=${RELAYER_FEE_SATS})` },
          { status: 400 }
        );
      }
      const ephemeralPub = stealthDataBytes[feeIdx].slice(0, 32);
      if (ephemeralPub.every((b: number) => b === 0)) {
        return NextResponse.json({ success: false, error: "Relayer fee output has invalid ephemeral public key" }, { status: 400 });
      }
    }

    // ── Upload proof to ChadBuffer ─────────────────────────────────────
    const { bufferPubkey } = await uploadDataToBuffer(connection, relayer, proofBytes, chadbufferProgramId, "Relay");

    // ── Build instruction data + accounts (per mode) ───────────────────
    let ixData: Uint8Array;
    const keys: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
    /** Set only when every unshield recipient already has an exit registered. */
    let registeredExits: PublicKey[] | null = null;

    if (mode === "unshield") {
      // ── UNSHIELD (disc=14, multi-output) ─────────────────────────────
      const { unshieldAmounts, recipientAddresses } = body;
      if (!unshieldAmounts?.length || !recipientAddresses?.length) {
        return NextResponse.json({ success: false, error: "Unshield requires: unshieldAmounts[], recipientAddresses[]" }, { status: 400 });
      }
      const nPublicOutputs = unshieldAmounts.length;
      if (recipientAddresses.length !== nPublicOutputs) {
        return NextResponse.json({ success: false, error: "Unshield arrays must have equal length" }, { status: 400 });
      }

      // Token being cashed out — defaults to zkBTC (byte-identical to before).
      // Any registered SPL token works: derive its program (the mint's owner),
      // pool vault, token config and recipient ATAs from the mint rather than
      // hardcoding zkBTC / Token-2022.
      const unshieldMintStr = request.nextUrl.searchParams.get("unshieldMint") || cfg.tokens.zkbtcMint;
      const unshieldMint = new PublicKey(unshieldMintStr);
      const mintInfo = await connection.getAccountInfo(unshieldMint);
      if (!mintInfo) {
        return NextResponse.json({ success: false, error: "Unshield token mint not found" }, { status: 400 });
      }
      const tokenProgramId = mintInfo.owner;
      const nativeSol = isNativeSolMint(unshieldMint.toBase58());

      const recipientPubkeys = recipientAddresses.map(a => new PublicKey(a));
      const recipientOutputPubkeys = nativeSol
        ? recipientPubkeys
        : recipientPubkeys.map(r => getAssociatedTokenAddressSync(unshieldMint, r, false, tokenProgramId));
      const poolVault = getAssociatedTokenAddressSync(unshieldMint, poolState, true, tokenProgramId);

      ixData = buildUnshieldInstructionData({
        nInputs, nOutputs,
        nPublicOutputs,
        merkleRoot: merkleRootBytes,
        boundParamsHash: boundParamsHashBytes,
        nullifiers: nullifierBytes,
        commitmentsOut: commitmentBytes,
        stealthData: stealthDataBytes,
        unshieldAmounts: unshieldAmounts.map(a => BigInt(a)),
        proofSource: 1,
      });

      // Accounts: pool_state, tree, vk, user, system, token_config, vault, token_program, recipients..., nullifiers...
      // Seed the token config with *this* vault's pool. The default is the pool of
      // whatever mint the SDK config happens to carry, which on a dual-vault network
      // is a different pool — and its token_config PDA does not exist, so the program
      // sees a system-owned account and rejects the spend.
      const [tokenConfigPDA] = deriveTokenConfigPDA(unshieldMint, programId, poolState);
      keys.push(
        { pubkey: poolState, isSigner: false, isWritable: true },
        { pubkey: commitmentTree, isSigner: false, isWritable: true },
        { pubkey: vkRegistryPDA, isSigner: false, isWritable: false },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenConfigPDA, isSigner: false, isWritable: true },
        { pubkey: poolVault, isSigner: false, isWritable: true },
        { pubkey: tokenProgramId, isSigner: false, isWritable: false },
      );
      for (const recipient of recipientOutputPubkeys) keys.push({ pubkey: recipient, isSigner: false, isWritable: true });
      for (const pda of nullifierPDAs) keys.push({ pubkey: pda, isSigner: false, isWritable: true });
      if (sourceTreeKey) keys.push({ pubkey: sourceTreeKey, isSigner: false, isWritable: false });
      keys.push({ pubkey: bufferPubkey, isSigner: false, isWritable: false });

      // Cashing out to an address you registered needs no approval at all — the
      // registry entry is the authorisation (`unshield.rs:275`). That is not an
      // emergency route, it is the faster one: no coordinator round trip and no
      // dependency on the operator being awake. Take it whenever every recipient
      // qualifies, and fall back to the approval path when any does not.
      if (cfg.solana.permissioned) {
        registeredExits = await resolveRegisteredExits(
          connection, programId, poolState, recipientPubkeys,
        );
      }

      // Native SOL recipients receive lamports directly. Ordinary SPL outputs
      // still require an ATA.
      if (!nativeSol) {
        for (let k = 0; k < nPublicOutputs; k++) {
          const ataInfo = await connection.getAccountInfo(recipientOutputPubkeys[k]);
          if (!ataInfo) {
            const createAtaIx = createAssociatedTokenAccountIdempotentInstruction(
              relayer.publicKey,
              recipientOutputPubkeys[k],
              recipientPubkeys[k],
              unshieldMint,
              tokenProgramId,
            );
            const ataTx = new Transaction().add(createAtaIx);
            const { blockhash: ataBlockhash } = await connection.getLatestBlockhash();
            ataTx.feePayer = relayer.publicKey;
            ataTx.recentBlockhash = ataBlockhash;
            await sendAndConfirmTransaction(connection, ataTx, [relayer], { commitment: "confirmed" });
          }
        }
      }

    } else if (mode === "redeem") {
      // ── REDEEM (disc=15, multi-output) ───────────────────────────────
      const { redeemAmounts, btcScripts, requestNonces } = body;
      if (!redeemAmounts?.length || !btcScripts?.length || !requestNonces?.length) {
        return NextResponse.json({ success: false, error: "Redeem requires: redeemAmounts[], btcScripts[], requestNonces[]" }, { status: 400 });
      }
      const nPublicOutputs = redeemAmounts.length;
      if (btcScripts.length !== nPublicOutputs || requestNonces.length !== nPublicOutputs) {
        return NextResponse.json({ success: false, error: "Redeem arrays must have equal length" }, { status: 400 });
      }

      const btcScriptBytesArr = btcScripts.map((s, i) => {
        const bytes = hexToBytes(s);
        if (bytes.length === 0 || bytes.length > 62) {
          throw new Error(`BTC script[${i}] must be 1-62 bytes, got ${bytes.length}`);
        }
        return bytes;
      });
      const requestNonceBigints = requestNonces.map(n => BigInt(n));

      const redemptionRequestPDAs = requestNonceBigints.map(n =>
        deriveRedemptionRequestPDA(relayer.publicKey, n, programId, poolState)[0]
      );
      const [tokenConfigPDA] = deriveTokenConfigPDA(zkbtcMint, programId, poolState);

      ixData = buildRedeemInstructionData({
        nInputs, nOutputs,
        nPublicOutputs,
        merkleRoot: merkleRootBytes,
        boundParamsHash: boundParamsHashBytes,
        nullifiers: nullifierBytes,
        commitmentsOut: commitmentBytes,
        stealthData: stealthDataBytes,
        redeemAmounts: redeemAmounts.map(a => BigInt(a)),
        btcScripts: btcScriptBytesArr,
        requestNonces: requestNonceBigints,
        proofSource: 1,
      });

      keys.push(
        { pubkey: poolState, isSigner: false, isWritable: true },
        { pubkey: commitmentTree, isSigner: false, isWritable: true },
        { pubkey: vkRegistryPDA, isSigner: false, isWritable: false },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
        { pubkey: tokenConfigPDA, isSigner: false, isWritable: true },
      );
      for (const pda of nullifierPDAs) keys.push({ pubkey: pda, isSigner: false, isWritable: true });
      for (const rpda of redemptionRequestPDAs) keys.push({ pubkey: rpda, isSigner: false, isWritable: true });
      if (sourceTreeKey) keys.push({ pubkey: sourceTreeKey, isSigner: false, isWritable: false });
      keys.push({ pubkey: bufferPubkey, isSigner: false, isWritable: false });

    } else {
      // ── TRANSFER (disc=13) ─────────────────────────────────────────
      if (body.senderMemos != null) {
        return NextResponse.json(
          { success: false, error: "senderMemos are disabled until they are proof-bound" },
          { status: 400 },
        );
      }

      ixData = buildTransactInstructionData({
        nInputs, nOutputs,
        merkleRoot: merkleRootBytes,
        boundParamsHash: boundParamsHashBytes,
        nullifiers: nullifierBytes,
        commitmentsOut: commitmentBytes,
        stealthData: stealthDataBytes,
        proofSource: 1,
      });

      keys.push(
        { pubkey: poolState, isSigner: false, isWritable: true },
        { pubkey: commitmentTree, isSigner: false, isWritable: true },
        { pubkey: vkRegistryPDA, isSigner: false, isWritable: false },
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      );
      for (const pda of nullifierPDAs) keys.push({ pubkey: pda, isSigner: false, isWritable: true });
      if (sourceTreeKey) keys.push({ pubkey: sourceTreeKey, isSigner: false, isWritable: false });
      keys.push({ pubkey: bufferPubkey, isSigner: false, isWritable: false });
    }

    let policyRequestId: string | null = null;
    if (cfg.solana.permissioned && registeredExits) {
      // Ragequit. The program recognises it by what sits at the tail: registry
      // entries here, an approval/policy pair otherwise (`resolve_spend_path`).
      // One entry per public output, immediately before the proof buffer.
      const bufferAt = keys.length - 1;
      keys.splice(bufferAt, 0, ...registeredExits.map((pubkey) => ({
        pubkey, isSigner: false, isWritable: false,
      })));
    } else if (cfg.solana.permissioned) {
      if (!body.policyRequestId) {
        throw new Error("Verified Privacy requires an approved policy request");
      }
      const approval = await resolvePolicyApproval({
        backendUrl: cfg.backend.url,
        requestId: body.policyRequestId,
        actor: relayer.publicKey.toBase58(),
      });
      policyRequestId = approval.requestId;
      keys.splice(keys.length - 1, 0, {
        pubkey: new PublicKey(approval.approvalAccount),
        isSigner: false,
        isWritable: true,
      });
      if (!cfg.solana.policyProgramId) {
        throw new Error("Verified Privacy policy program is not configured");
      }
      keys.splice(keys.length - 1, 0, {
        pubkey: new PublicKey(cfg.solana.policyProgramId),
        isSigner: false,
        isWritable: false,
      });
    }

    // ── Submit transaction ─────────────────────────────────────────────
    const mainIx = new TransactionInstruction({
      programId,
      keys,
      data: Buffer.from(ixData),
    });

    const tx = new Transaction().add(
      ComputeBudgetProgram.setComputeUnitLimit({ units: 1_400_000 }),
      mainIx
    );
    console.log(`[Relay] Submitting ${mode} transaction...`);
    tx.feePayer = relayer.publicKey;
    const signature = await sendAndConfirmTransaction(connection, tx, [relayer], {
      commitment: "confirmed",
    });
    console.log(`[Relay] Transaction confirmed: ${signature}`);

    // Close buffer and reclaim rent
    try {
      await closeBuffer(connection, relayer, bufferPubkey, chadbufferProgramId, "Relay");
    } catch (closeErr) {
      console.warn("[Relay] Failed to close buffer (non-critical):", closeErr);
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`[Relay] ${mode} complete in ${duration}s`);

    return NextResponse.json({
      success: true,
      signature,
      bufferAddress: bufferPubkey.toBase58(),
      executionMode: "solana",
      ...(policyRequestId ? { policyRequestId } : {}),
    });
  } catch (error) {
    console.error("[Relay] Error:", error);
    const errObj = error as Record<string, unknown> | null;
    const logs = (errObj && 'logs' in errObj ? errObj.logs : null)
      ?? (errObj && 'transactionError' in errObj ? (errObj.transactionError as Record<string, unknown>)?.logs : null)
      ?? null;
    return NextResponse.json(
      {
        success: false,
        error: process.env.NODE_ENV === "development" ? (error instanceof Error ? error.message : "Unknown error") : "Transaction failed",
        logs: process.env.NODE_ENV === "development" ? logs : undefined,
      },
      { status: 500 }
    );
  }
}
