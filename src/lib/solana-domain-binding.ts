import {
  BN254_FIELD_PRIME,
  bytesToBigint,
  computeBoundParamsHash,
  poseidonHashSync,
  sha256Hash,
  type BoundParams,
} from "@utxopia/sdk";

export type SolanaPrivacyDomainKind = "public" | "institution";

export interface SolanaPrivacyDomainContext {
  programId: Uint8Array;
  poolState: Uint8Array;
  kind: SolanaPrivacyDomainKind;
}

const SOLANA_DEVNET_CHAIN_ID = 103n;
const SOLANA_MAINNET_CHAIN_ID = 101n;
const DOMAIN_TAG = new TextEncoder().encode("UTXOPIA_DOMAIN_V1");

function assert32Bytes(value: Uint8Array, name: string): void {
  if (value.length !== 32) {
    throw new Error(`${name} must be 32 bytes`);
  }
}

function u64le(value: bigint): Uint8Array {
  if (value < 0n || value > 0xffffffffffffffffn) {
    throw new Error("chainId must fit in u64");
  }

  const result = new Uint8Array(8);
  let remaining = value;
  for (let i = 0; i < result.length; i++) {
    result[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return result;
}

export function computeSolanaDomainSeparator(
  context: SolanaPrivacyDomainContext,
  chainId: bigint = SOLANA_DEVNET_CHAIN_ID,
): bigint {
  assert32Bytes(context.programId, "programId");
  assert32Bytes(context.poolState, "poolState");
  if (context.kind !== "public" && context.kind !== "institution") {
    throw new Error("kind must be public or institution");
  }

  const preimage = new Uint8Array(DOMAIN_TAG.length + 8 + 32 + 32 + 1);
  let offset = 0;
  preimage.set(DOMAIN_TAG, offset);
  offset += DOMAIN_TAG.length;
  preimage.set(u64le(chainId), offset);
  offset += 8;
  preimage.set(context.programId, offset);
  offset += 32;
  preimage.set(context.poolState, offset);
  offset += 32;
  preimage[offset] = context.kind === "institution" ? 1 : 0;

  return bytesToBigint(sha256Hash(preimage)) % BN254_FIELD_PRIME;
}

export function computeSolanaDomainBoundParamsHash(
  params: BoundParams,
  context: SolanaPrivacyDomainContext,
): bigint {
  if (
    params.chainId !== SOLANA_DEVNET_CHAIN_ID
    && params.chainId !== SOLANA_MAINNET_CHAIN_ID
  ) {
    throw new Error("Solana domain binding requires a supported Solana chain ID");
  }
  return poseidonHashSync([
    computeSolanaDomainSeparator(context, params.chainId),
    computeBoundParamsHash(params),
  ]);
}
