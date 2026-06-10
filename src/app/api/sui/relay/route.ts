import { NextRequest, NextResponse } from "next/server";
import { UTXOpiaSuiAdapter } from "@utxopia/sdk/sui";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  type NetworkConfig,
  type NetworkId,
} from "@/lib/network-config";
import { networkForChain } from "@/lib/chain-registry";
import { checkRateLimit, getClientIp, tooManyRequests } from "@/lib/server/rate-limit";
import { executeSuiTransactionKind } from "@/lib/server/sui-relayer";

export const dynamic = "force-dynamic";

interface SuiRelayRequest {
  mode: "transfer" | "unshield" | "redeem";
  nInputs: number;
  nOutputs: number;
  proof: string;
  merkleRoot: string;
  boundParamsHash: string;
  nullifiers: string[];
  commitmentsOut: string[];
  stealthData: string[];
  redeemAmounts?: string[];
  btcScripts?: string[];
  // Unshield-specific (generic Coin<T> release)
  coinType?: string;
  unshieldAmounts?: string[];
  recipientAddresses?: string[];
}

export async function POST(request: NextRequest) {
  const rl = checkRateLimit(getClientIp(request.headers), "sui-relay", { maxTokens: 10, windowMs: 60_000 });
  const limited = tooManyRequests(rl);
  if (limited) return limited;

  try {
    const network = request.nextUrl.searchParams.get("network") as NetworkId | null
      ?? detectNetworkFromRequest(request);
    const suiNetwork = networkForChain(network, "sui");
    const cfg = getNetworkConfig(suiNetwork);
    const body = await request.json() as SuiRelayRequest;
    // coinType may arrive via query string (it is outside the typed relay payload).
    const coinTypeParam = request.nextUrl.searchParams.get("coinType");
    if (coinTypeParam && !body.coinType) body.coinType = coinTypeParam;

    validateCommon(body);
    const adapter = createSuiAdapter(cfg);
    // The SDK serializes proofs as 256-byte uncompressed big-endian (Solana
    // format); Sui's verifier wants arkworks compressed serialization.
    const proofPoints = arkworksCompressProof(hexToBytes(body.proof));
    const merkleRoot = hexToBytes(body.merkleRoot);
    const boundParamsHash = hexToBytes(body.boundParamsHash);
    const nullifiers = body.nullifiers.map((value, i) => validateHex(value, `nullifiers[${i}]`, 32));
    const commitments = body.commitmentsOut.map((value, i) => validateHex(value, `commitmentsOut[${i}]`, 32));
    const stealthData = body.stealthData.map((value, i) => validateHex(value, `stealthData[${i}]`, undefined));
    // The Move verifier consumes arkworks little-endian public inputs (the
    // contract reverses each 32-byte chunk back to BE for its asserts);
    // nullifiers_in/commitments_out args stay big-endian.
    const toLe = (bytes: Uint8Array) => Uint8Array.from(bytes).reverse();
    const publicInputs = concatBytes([toLe(merkleRoot), toLe(boundParamsHash), ...nullifiers.map(toLe), ...commitments.map(toLe)]);
    const vkHash = getVkHash(cfg, body.nInputs, body.nOutputs);

    if (body.mode === "unshield") {
      if (!body.coinType) throw new Error("Unshield requires coinType");
      const amounts = (body.unshieldAmounts ?? []).map((amount) => BigInt(amount));
      const recipients = body.recipientAddresses ?? [];
      const nPublicOutputs = recipients.length;
      if (nPublicOutputs === 0 || amounts.length !== nPublicOutputs) {
        throw new Error("Unshield requires matching recipientAddresses[] and unshieldAmounts[]");
      }
      const unshieldTx = await adapter.buildUnshieldTransaction({
        coinType: body.coinType,
        nInputs: body.nInputs,
        nOutputs: body.nOutputs,
        nPublicOutputs,
        vkHash,
        publicInputs,
        proofPoints,
        nullifiers,
        commitmentsOut: commitments,
        stealthData,
        amounts,
        recipients,
      });
      const unshieldResult = await executeSuiTransactionKind({
        rpcUrl: cfg.sui!.rpcUrl,
        bytes: unshieldTx.bytes,
      });
      const unshieldStatus = unshieldResult.effects?.status.status;
      if (unshieldStatus !== "success") {
        return NextResponse.json({
          success: false,
          error: unshieldResult.effects?.status.error ?? "Sui transaction failed",
          digest: unshieldResult.digest,
        }, { status: 500 });
      }
      return NextResponse.json({
        success: true,
        signature: unshieldResult.digest,
        digest: unshieldResult.digest,
        chain: "sui",
      });
    }

    const redemptionInput: Parameters<UTXOpiaSuiAdapter["buildRedemptionTransaction"]>[0] = {
      nInputs: body.nInputs,
      nOutputs: body.nOutputs,
      proof: proofPoints,
      vkHash,
      publicInputs,
      proofPoints,
      nullifiers,
      commitmentsOut: commitments,
      btcScripts: (body.btcScripts ?? []).map((script, i) => validateHex(script, `btcScripts[${i}]`, undefined)),
      amountsSats: (body.redeemAmounts ?? []).map((amount) => BigInt(amount)),
      maxFeesSats: (body.redeemAmounts ?? []).map(() => BigInt(process.env.UTXOPIA_SUI_REDEEM_MAX_FEE_SATS ?? "20000")),
      nPublicOutputs: body.redeemAmounts?.length ?? 0,
      stealthData,
    };

    const tx = body.mode === "redeem"
      ? await adapter.buildRedemptionTransaction(redemptionInput)
      : await adapter.buildTransactTransaction({
        nInputs: body.nInputs,
        nOutputs: body.nOutputs,
        proof: proofPoints,
        boundParamsHash: body.boundParamsHash,
        vkHash,
        publicInputs,
        proofPoints,
        nullifiers,
        commitmentsOut: commitments,
        stealthData,
      });

    const result = await executeSuiTransactionKind({
      rpcUrl: cfg.sui!.rpcUrl,
      bytes: tx.bytes,
    });
    const status = result.effects?.status.status;
    if (status !== "success") {
      return NextResponse.json({
        success: false,
        error: result.effects?.status.error ?? "Sui transaction failed",
        digest: result.digest,
      }, { status: 500 });
    }

    return NextResponse.json({
      success: true,
      signature: result.digest,
      digest: result.digest,
      chain: "sui",
    });
  } catch (err) {
    console.error("[Sui Relay] Error:", err);
    return NextResponse.json({
      success: false,
      error: err instanceof Error ? err.message : "Sui relay failed",
    }, { status: 500 });
  }
}

function validateCommon(body: SuiRelayRequest): void {
  if (!Number.isInteger(body.nInputs) || !Number.isInteger(body.nOutputs) || body.nInputs < 1 || body.nOutputs < 1) {
    throw new Error("Invalid circuit dimensions");
  }
  validateHex(body.proof, "proof", 256);
  validateHex(body.merkleRoot, "merkleRoot", 32);
  validateHex(body.boundParamsHash, "boundParamsHash", 32);
  if (body.nullifiers.length !== body.nInputs) {
    throw new Error(`Expected ${body.nInputs} nullifiers, got ${body.nullifiers.length}`);
  }
  if (body.commitmentsOut.length !== body.nOutputs) {
    throw new Error(`Expected ${body.nOutputs} commitments, got ${body.commitmentsOut.length}`);
  }
  const nPublicOutputs = body.mode === "transfer"
    ? 0
    : body.mode === "unshield"
      ? (body.recipientAddresses?.length ?? 1)
      : 1;
  const expectedStealthCount = body.nOutputs - nPublicOutputs;
  if (body.stealthData.length !== expectedStealthCount) {
    throw new Error(`Expected ${expectedStealthCount} stealth data entries, got ${body.stealthData.length}`);
  }
  body.stealthData.forEach((value, i) => {
    validateHex(value, `stealthData[${i}]`, 72);
  });
  if (body.mode === "unshield") {
    if (!body.coinType) throw new Error("Unshield requires coinType");
    if (!body.recipientAddresses?.length || !body.unshieldAmounts?.length) {
      throw new Error("Unshield requires recipientAddresses[] and unshieldAmounts[]");
    }
    if (body.recipientAddresses.length !== body.unshieldAmounts.length) {
      throw new Error("Unshield arrays must have equal length");
    }
  }
  if (body.mode === "redeem") {
    if (!body.redeemAmounts?.length || !body.btcScripts?.length) {
      throw new Error("Redeem requires redeemAmounts[] and btcScripts[]");
    }
    if (body.redeemAmounts.length !== body.btcScripts.length) {
      throw new Error("Redeem arrays must have equal length");
    }
  }
}

function createSuiAdapter(cfg: NetworkConfig): UTXOpiaSuiAdapter {
  const sui = cfg.sui;
  if (!sui) throw new Error("Sui configuration is missing");
  return new UTXOpiaSuiAdapter({
    rpcUrl: sui.rpcUrl,
    packageId: sui.packageId,
    poolObjectId: sui.pool.objectId,
    poolInitialSharedVersion: sui.pool.initialSharedVersion,
    commitmentTreeObjectId: sui.commitmentTree?.objectId,
    commitmentTreeInitialSharedVersion: sui.commitmentTree?.initialSharedVersion,
    btcDepositRegistryObjectId: sui.btcDepositRegistry?.objectId,
    btcDepositRegistryInitialSharedVersion: sui.btcDepositRegistry?.initialSharedVersion,
    utxoSetObjectId: sui.utxoSet?.objectId,
    utxoSetInitialSharedVersion: sui.utxoSet?.initialSharedVersion,
    lightClientObjectId: sui.lightClient?.objectId,
    lightClientInitialSharedVersion: sui.lightClient?.initialSharedVersion,
    verifyingKeyRegistryObjectId: sui.verifyingKeyRegistry.objectId,
    verifyingKeyRegistryInitialSharedVersion: sui.verifyingKeyRegistry.initialSharedVersion,
    nullifierRegistryObjectId: sui.nullifierRegistry.objectId,
    nullifierRegistryInitialSharedVersion: sui.nullifierRegistry.initialSharedVersion,
    redemptionQueueObjectId: sui.redemptionQueue.objectId,
    redemptionQueueInitialSharedVersion: sui.redemptionQueue.initialSharedVersion,
    redemptionCapObjectId: sui.redemptionCap.objectId,
    redemptionCapVersion: sui.redemptionCap.version,
    redemptionCapDigest: sui.redemptionCap.digest,
    tokenRegistryObjectId: sui.tokenRegistry?.objectId,
    tokenRegistryInitialSharedVersion: sui.tokenRegistry?.initialSharedVersion,
  });
}

function getVkHash(cfg: NetworkConfig, nInputs: number, nOutputs: number): Uint8Array {
  const key = `joinsplit_${nInputs}x${nOutputs}`;
  const hash = cfg.sui?.vk?.[key]?.vkHash;
  if (!hash) {
    throw new Error(`Sui verifying key hash missing for ${key}`);
  }
  return validateHex(hash, `vk.${key}`, 32);
}

// BN254 base field modulus
const BN254_FQ = 21888242871839275222246405745257275088696311157297823662689037894645226208583n;

/**
 * Convert a 256-byte uncompressed big-endian Groth16 proof
 * (A.x|A.y | B.x_im|B.x_re|B.y_im|B.y_re | C.x|C.y) to the 128-byte arkworks
 * compressed form Sui's verifier expects (x little-endian, y-sign/infinity
 * flags in the top bits of the final byte; Fq2 ordered c0|c1, sign compared
 * lexicographically on (c1, c0)). Validated byte-identical against
 * sui-groth16-exporter's ark-serialize output.
 */
function arkworksCompressProof(proof: Uint8Array): Uint8Array {
  if (proof.length !== 256) throw new Error(`Expected 256-byte proof, got ${proof.length}`);
  const toBig = (b: Uint8Array) => { let v = 0n; for (const x of b) v = (v << 8n) | BigInt(x); return v; };
  const leBytes = (v: bigint, n: number) => {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) { out[i] = Number(v & 0xffn); v >>= 8n; }
    return out;
  };
  const g1 = (xBE: Uint8Array, yBE: Uint8Array) => {
    const x = toBig(xBE), y = toBig(yBE);
    const out = leBytes(x, 32);
    if (x === 0n && y === 0n) { out[31] |= 0x40; return out; }
    if (y > BN254_FQ - y) out[31] |= 0x80;
    return out;
  };
  const g2 = (xImBE: Uint8Array, xReBE: Uint8Array, yImBE: Uint8Array, yReBE: Uint8Array) => {
    const xc0 = toBig(xReBE), xc1 = toBig(xImBE), yc0 = toBig(yReBE), yc1 = toBig(yImBE);
    const out = new Uint8Array(64);
    out.set(leBytes(xc0, 32), 0);
    out.set(leBytes(xc1, 32), 32);
    if (xc0 === 0n && xc1 === 0n && yc0 === 0n && yc1 === 0n) { out[63] |= 0x40; return out; }
    const negative = yc1 !== 0n ? yc1 > BN254_FQ - yc1 : yc0 > BN254_FQ - yc0;
    if (negative) out[63] |= 0x80;
    return out;
  };
  const result = new Uint8Array(128);
  result.set(g1(proof.slice(0, 32), proof.slice(32, 64)), 0);
  result.set(g2(proof.slice(64, 96), proof.slice(96, 128), proof.slice(128, 160), proof.slice(160, 192)), 32);
  result.set(g1(proof.slice(192, 224), proof.slice(224, 256)), 96);
  return result;
}

function validateHex(value: string | undefined, name: string, expectedBytes?: number): Uint8Array {
  if (!value) throw new Error(`Missing required field: ${name}`);
  const bytes = hexToBytes(value);
  if (expectedBytes !== undefined && bytes.length !== expectedBytes) {
    throw new Error(`Invalid ${name}: expected ${expectedBytes} bytes, got ${bytes.length}`);
  }
  return bytes;
}

function hexToBytes(hex: string): Uint8Array {
  const normalized = hex.startsWith("0x") ? hex.slice(2) : hex;
  if (normalized.length % 2 !== 0 || !/^[0-9a-fA-F]*$/.test(normalized)) {
    throw new Error("Invalid hex string");
  }
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
