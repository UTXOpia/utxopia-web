/**
 * PoolState fees — the layout and the arithmetic both live in `@utxopia/sdk`,
 * next to the TokenConfig and CommitmentTree decoders, because both mirror the
 * program. This file only re-exports, so existing imports keep working.
 */
export {
  BPS_DENOMINATOR,
  computeBpsFee,
  feeShareBps,
  parsePoolFees,
  parsePoolState,
  POOL_STATE_OFFSETS,
} from "@utxopia/sdk";
export type { PoolFees, PoolState } from "@utxopia/sdk";
