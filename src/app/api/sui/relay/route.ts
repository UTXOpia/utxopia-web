import { NextRequest, NextResponse } from "next/server";
import { UTXOpiaSuiAdapter } from "@utxopia/sdk/sui";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  type NetworkConfig,
  type NetworkId,
} from "@/lib/network-config";
import { networkForChain } from "@/lib/chain-registry";
import { checkRateLimit, getClientIp } from "@/lib/server/rate-limit";
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
}

export async function POST(request: NextRequest) {
  const ip = getClientIp(request.headers);
  const rl = checkRateLimit(ip, "sui-relay", { maxTokens: 10, windowMs: 60_000 });
  if (rl.limited) {
    return NextResponse.json(
      { success: false, error: "Too many requests" },
      { status: 429, headers: { "Retry-After": String(Math.ceil((rl.retryAfterMs ?? 6000) / 1000)) } },
    );
  }

  try {
    const network = request.nextUrl.searchParams.get("network") as NetworkId | null
      ?? detectNetworkFromRequest(request);
    const suiNetwork = networkForChain(network, "sui");
    const cfg = getNetworkConfig(suiNetwork);
    const body = await request.json() as SuiRelayRequest;

    if (body.mode === "unshield") {
      return NextResponse.json({
        success: false,
        error: "Sui public unshield is not enabled; use private transfer or BTC withdraw",
      }, { status: 400 });
    }

    validateCommon(body);
    const adapter = createSuiAdapter(cfg);
    const proofPoints = hexToBytes(body.proof);
    const merkleRoot = hexToBytes(body.merkleRoot);
    const boundParamsHash = hexToBytes(body.boundParamsHash);
    const nullifiers = body.nullifiers.map((value, i) => validateHex(value, `nullifiers[${i}]`, 32));
    const commitments = body.commitmentsOut.map((value, i) => validateHex(value, `commitmentsOut[${i}]`, 32));
    const stealthData = body.stealthData.map((value, i) => validateHex(value, `stealthData[${i}]`, undefined));
    const publicInputs = concatBytes([merkleRoot, boundParamsHash, ...nullifiers, ...commitments]);
    const vkHash = getVkHash(cfg, body.nInputs, body.nOutputs);

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
  const expectedStealthCount = body.mode === "transfer" ? body.nOutputs : body.nOutputs - 1;
  if (body.stealthData.length !== expectedStealthCount) {
    throw new Error(`Expected ${expectedStealthCount} stealth data entries, got ${body.stealthData.length}`);
  }
  body.stealthData.forEach((value, i) => {
    validateHex(value, `stealthData[${i}]`, 72);
  });
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
