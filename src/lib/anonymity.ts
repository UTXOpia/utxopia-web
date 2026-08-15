/**
 * Anonymity arithmetic for the per-token pool view.
 *
 * Everything here runs on public deposit data that the client already holds, so
 * working out how exposed an amount is never tells the server which amount the
 * user cares about.
 *
 * Deliberately absent: a score. Anonymity is "how many others could be you",
 * and that number collapses to 1 on a single detail — a percentage would hide
 * exactly the case the user needs to see.
 *
 * @module anonymity
 */

export interface DepositPoint {
  /** Smallest units (sats, lamports, micro-USDC). */
  amount: number;
  /** Unix seconds; 0 when the indexer never got a block time. */
  blockTime: number;
}

/** Relative band an observer would allow when matching a withdrawal to a
 *  deposit — wide enough to absorb protocol and relayer fees. */
export const SIMILAR_TOLERANCE = 0.02;

/** Below this many look-alike deposits, matching is a short guess-list. */
export const THIN_SIMILAR_SET = 5;

export const VERY_RECENT_MS = 60 * 60 * 1000;
export const RECENT_MS = 24 * 60 * 60 * 1000;

/** Deposits whose amount sits within `tolerance` of `amount`. */
export function countSimilarDeposits(
  deposits: DepositPoint[],
  amount: number,
  tolerance = SIMILAR_TOLERANCE,
): number {
  if (amount <= 0) return 0;
  const lo = amount * (1 - tolerance);
  const hi = amount * (1 + tolerance);
  return deposits.reduce((n, d) => (d.amount >= lo && d.amount <= hi ? n + 1 : n), 0);
}

/** Deposits at exactly this amount. One means the amount is a fingerprint. */
export function countExactDeposits(deposits: DepositPoint[], amount: number): number {
  return deposits.reduce((n, d) => (d.amount === amount ? n + 1 : n), 0);
}

export interface NoteExposure {
  similarCount: number;
  exactCount: number;
  ageMs: number;
  /** Exactly one deposit carries this amount — almost certainly this note's own. */
  isFingerprint: boolean;
  /** Too few look-alikes for the crowd to hide in. */
  isThin: boolean;
  isVeryRecent: boolean;
  isRecent: boolean;
}

export function assessNote(
  amount: number,
  createdAtMs: number,
  deposits: DepositPoint[],
  nowMs: number,
): NoteExposure {
  const similarCount = countSimilarDeposits(deposits, amount);
  const exactCount = countExactDeposits(deposits, amount);
  const ageMs = Math.max(0, nowMs - createdAtMs);
  return {
    similarCount,
    exactCount,
    ageMs,
    isFingerprint: exactCount === 1,
    isThin: similarCount < THIN_SIMILAR_SET,
    isVeryRecent: ageMs < VERY_RECENT_MS,
    isRecent: ageMs < RECENT_MS,
  };
}

export interface HistogramBucket {
  /** Inclusive lower bound, smallest units. */
  lo: number;
  /** Exclusive upper bound, except in the last bucket where it is inclusive. */
  hi: number;
  count: number;
}

/**
 * Log-scale buckets. Deposit sizes are heavy-tailed — on a linear axis a single
 * whale drops every other deposit into bucket zero and the chart says nothing.
 */
export function buildHistogram(deposits: DepositPoint[], bucketCount = 12): HistogramBucket[] {
  const amounts = deposits.map((d) => d.amount).filter((a) => a > 0);
  if (amounts.length === 0 || bucketCount < 1) return [];

  const min = Math.min(...amounts);
  const max = Math.max(...amounts);
  if (min === max) return [{ lo: min, hi: max, count: amounts.length }];

  const logMin = Math.log10(min);
  const step = (Math.log10(max) - logMin) / bucketCount;
  const buckets: HistogramBucket[] = Array.from({ length: bucketCount }, (_, i) => ({
    lo: 10 ** (logMin + i * step),
    hi: 10 ** (logMin + (i + 1) * step),
    count: 0,
  }));

  for (const a of amounts) {
    const raw = Math.floor((Math.log10(a) - logMin) / step);
    buckets[Math.min(bucketCount - 1, Math.max(0, raw))].count += 1;
  }
  return buckets;
}

/** Index of the bucket holding `amount`, or -1. Used to mark the user's position. */
export function bucketIndexOf(buckets: HistogramBucket[], amount: number): number {
  if (amount <= 0) return -1;
  for (let i = 0; i < buckets.length; i++) {
    const last = i === buckets.length - 1;
    if (amount >= buckets[i].lo && (last ? amount <= buckets[i].hi : amount < buckets[i].hi)) {
      return i;
    }
  }
  return -1;
}
