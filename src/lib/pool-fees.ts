export const BPS_DENOMINATOR = 10_000n;

const POOL_STATE_DISCRIMINATOR = 0x01;
const DEPOSIT_FEE_BPS_OFFSET = 244;
const WITHDRAWAL_FEE_BPS_OFFSET = 246;
const MIN_POOL_STATE_SIZE = WITHDRAWAL_FEE_BPS_OFFSET + 2;

export interface PoolFees {
  depositFeeBps: number;
  withdrawalFeeBps: number;
}

export function parsePoolFees(data: Uint8Array): PoolFees | null {
  if (data.length < MIN_POOL_STATE_SIZE || data[0] !== POOL_STATE_DISCRIMINATOR) {
    return null;
  }
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return {
    depositFeeBps: view.getUint16(DEPOSIT_FEE_BPS_OFFSET, true),
    withdrawalFeeBps: view.getUint16(WITHDRAWAL_FEE_BPS_OFFSET, true),
  };
}

/**
 * Compute an on-chain basis-point fee. Unshield withdrawals enforce a
 * one-unit minimum; deposits use plain floor division.
 */
export function computeBpsFee(
  amount: bigint,
  bps: number,
  minimumOne = true,
): bigint {
  if (amount <= 0n || bps <= 0) return 0n;
  const fee = amount * BigInt(bps) / BPS_DENOMINATOR;
  return fee > 0n || !minimumOne ? fee : 1n;
}

export function feeShareBps(fee: bigint, gross: bigint): number {
  if (fee <= 0n || gross <= 0n) return 0;
  return Number(fee * BPS_DENOMINATOR / gross);
}
