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

/** Mantissas of the standard log-axis ladder: 1, 2, 5, 10, 20, 50, … */
const LADDER = [1, 2, 5];
/** Absorbs the float error in 10 ** log10(x) round-trips. */
const EPS = 1e-9;

function decadeOf(v: number): number {
  return 10 ** Math.floor(Math.log10(v) + EPS);
}

/** Largest ladder value <= v. */
function ladderFloor(v: number): number {
  const decade = decadeOf(v);
  const mantissa = v / decade;
  let edge = decade;
  for (const rung of LADDER) {
    if (rung <= mantissa + EPS) edge = rung * decade;
  }
  return edge;
}

/** Next ladder value strictly above v (v is assumed to sit on the ladder). */
function ladderNext(v: number): number {
  const decade = decadeOf(v);
  const mantissa = v / decade;
  for (const rung of LADDER) {
    if (rung > mantissa + EPS) return rung * decade;
  }
  return 10 * decade;
}

/** True when a bound is a whole power of ten — the only edges worth labelling. */
export function isDecadeEdge(v: number): boolean {
  return v > 0 && Math.abs(v / decadeOf(v) - 1) < EPS;
}

/**
 * Log-scale buckets on a 1-2-5 ladder.
 *
 * Log scale because deposit sizes are heavy-tailed: on a linear axis one whale
 * drops every other deposit into bucket zero and the chart says nothing.
 *
 * The ladder — rather than slicing the observed min..max into N equal steps —
 * because data-derived edges come out as "0.00998" and "0.998", which a reader
 * cannot distinguish from 0.01 and 1. Round edges also keep the axis stable as
 * deposits arrive, instead of every bar shifting when a new outlier lands.
 *
 * `maxBuckets` coarsens the ladder to whole decades rather than truncating the
 * range, so a pool spanning many orders of magnitude stays fully shown.
 */
export function buildHistogram(deposits: DepositPoint[], maxBuckets = 16): HistogramBucket[] {
  const amounts = deposits.map((d) => d.amount).filter((a) => a > 0);
  if (amounts.length === 0 || maxBuckets < 1) return [];

  const min = Math.min(...amounts);
  const max = Math.max(...amounts);

  const buildEdges = (next: (v: number) => number): number[] => {
    const edges = [ladderFloor(min)];
    while (edges[edges.length - 1] <= max + EPS) edges.push(next(edges[edges.length - 1]));
    return edges;
  };

  let edges = buildEdges(ladderNext);
  if (edges.length - 1 > maxBuckets) {
    // Too many rungs — fall back to whole decades, which is 3x coarser.
    edges = buildEdges((v) => decadeOf(v) * 10);
  }

  const buckets: HistogramBucket[] = edges.slice(0, -1).map((lo, i) => ({
    lo,
    hi: edges[i + 1],
    count: 0,
  }));

  for (const a of amounts) {
    // Last bucket is inclusive of its upper bound, so `max` itself lands inside.
    let i = buckets.findIndex((b) => a >= b.lo && a < b.hi);
    if (i === -1) i = buckets.length - 1;
    buckets[i].count += 1;
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
