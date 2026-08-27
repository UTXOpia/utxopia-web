import { describe, expect, it } from "bun:test";
import {
  assessNote,
  crowdNote,
  bucketIndexOf,
  buildHistogram,
  countDepositsAtLeast,
  countExactDeposits,
  countDepositsSince,
  countSimilarDeposits,
  buildDailyActivity,
  DAY_MS,
  isDecadeEdge,
  RECENT_MS,
  VERY_RECENT_MS,
} from "../anonymity";

const at = (...amounts: number[]) => amounts.map((amount) => ({ amount, blockTime: 0 }));

describe("similar deposits", () => {
  it("counts within the fee tolerance band, not exact equality", () => {
    const deposits = at(100_000, 101_000, 99_500, 130_000);
    expect(countSimilarDeposits(deposits, 100_000)).toBe(3);
  });

  it("excludes amounts past the band edge", () => {
    // 2% of 100_000 is 2_000, so 102_001 falls outside.
    expect(countSimilarDeposits(at(102_000, 102_001), 100_000)).toBe(1);
  });

  it("returns zero for a non-positive amount rather than matching everything", () => {
    expect(countSimilarDeposits(at(1, 2, 3), 0)).toBe(0);
  });
});

describe("exact deposits", () => {
  it("counts only identical amounts", () => {
    expect(countExactDeposits(at(50, 50, 51), 50)).toBe(2);
    expect(countExactDeposits(at(50, 51), 52)).toBe(0);
  });
});

describe("deposits big enough to be the source", () => {
  it("counts deposits at or above the amount", () => {
    expect(countDepositsAtLeast(at(50, 100, 150, 200), 100)).toBe(3);
  });

  it("excludes every deposit below it, however close", () => {
    expect(countDepositsAtLeast(at(99, 99.999), 100)).toBe(0);
  });

  it("flags a note no other deposit could have funded", () => {
    const now = 1_700_000_000_000;
    const e = assessNote(1_000, now - RECENT_MS * 5, at(1_000, 500, 100), now);
    expect(e.atLeastCount).toBe(1);
    expect(e.isSoleSource).toBe(true);
  });

  it("does not flag it once a larger deposit lands", () => {
    const now = 1_700_000_000_000;
    const e = assessNote(1_000, now - RECENT_MS * 5, at(1_000, 5_000), now);
    expect(e.atLeastCount).toBe(2);
    expect(e.isSoleSource).toBe(false);
  });

  it("counts a bigger crowd than the look-alike band does", () => {
    const now = 1_700_000_000_000;
    // 2_000 and 9_000 are outside ±2% of 1_000 but could still fund it.
    const e = assessNote(1_000, now, at(1_000, 2_000, 9_000, 10), now);
    expect(e.similarCount).toBe(1);
    expect(e.atLeastCount).toBe(3);
  });
});

describe("assessNote", () => {
  const now = 1_700_000_000_000;

  it("flags a fingerprint when one deposit carries the amount", () => {
    const e = assessNote(23_103, now - RECENT_MS * 10, at(23_103, 500_000, 900_000), now);
    expect(e.exactCount).toBe(1);
    expect(e.isFingerprint).toBe(true);
    expect(e.isRecent).toBe(false);
  });

  it("does not flag a fingerprint for an amount absent from deposits", () => {
    // Change from a private transfer never appears as a deposit amount.
    const e = assessNote(777, now, at(1_000, 2_000), now);
    expect(e.exactCount).toBe(0);
    expect(e.isFingerprint).toBe(false);
  });

  it("clears the fingerprint flag once other deposits share the amount", () => {
    const e = assessNote(1_000, now, at(1_000, 1_000, 1_000), now);
    expect(e.isFingerprint).toBe(false);
  });

  it("calls a thin crowd thin", () => {
    expect(assessNote(1_000, now, at(1_000, 1_000), now).isThin).toBe(true);
    expect(assessNote(1_000, now, at(1_000, 1_000, 1_000, 1_000, 1_000), now).isThin).toBe(false);
  });

  it("does not call a small note exposed just for having no same-size neighbours", () => {
    // The real case: a 0.00006 SOL note in a pool of 0.01 SOL deposits. No
    // look-alikes, but every deposit could have funded it.
    const pool = at(...Array.from({ length: 38 }, () => 10_000_000));
    const e = assessNote(60_000, now, pool, now);
    expect(e.similarCount).toBe(0);
    expect(e.atLeastCount).toBe(38);
    expect(e.isThin).toBe(false);
  });

  it("still calls it thin when the big-enough set is genuinely small", () => {
    const e = assessNote(1_000_000, now, at(1_000_000, 2_000_000, 10), now);
    expect(e.atLeastCount).toBe(2);
    expect(e.isThin).toBe(true);
  });

  it("separates very recent from recent", () => {
    const fresh = assessNote(1, now - VERY_RECENT_MS / 2, at(1), now);
    expect(fresh.isVeryRecent).toBe(true);
    expect(fresh.isRecent).toBe(true);

    const day = assessNote(1, now - RECENT_MS / 2, at(1), now);
    expect(day.isVeryRecent).toBe(false);
    expect(day.isRecent).toBe(true);
  });

  it("treats a future timestamp as age zero instead of negative", () => {
    expect(assessNote(1, now + 5_000, at(1), now).ageMs).toBe(0);
  });
});

describe("histogram", () => {
  it("spreads a heavy tail across buckets instead of piling into the first", () => {
    const buckets = buildHistogram(at(1, 10, 100, 1_000, 10_000, 100_000), 6);
    expect(buckets).toHaveLength(6);
    expect(buckets.every((b) => b.count > 0)).toBe(true);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(6);
  });

  it("collapses to one ladder rung when every deposit is the same size", () => {
    expect(buildHistogram(at(500, 500, 500))).toEqual([{ lo: 500, hi: 1000, count: 3 }]);
  });

  it("puts every edge on the 1-2-5 ladder, not on the observed min and max", () => {
    // A pool of 0.00998–0.998 SOL used to produce those exact edges as labels.
    const buckets = buildHistogram(at(9_980_000, 12_000_000, 998_000_000));
    expect(buckets[0].lo).toBe(5_000_000);
    expect(buckets[buckets.length - 1].hi).toBe(1_000_000_000);
    for (const b of buckets) {
      const mantissa = b.lo / 10 ** Math.floor(Math.log10(b.lo) + 1e-9);
      expect([1, 2, 5]).toContain(Math.round(mantissa));
    }
  });

  it("keeps edges stable when a new outlier arrives", () => {
    const before = buildHistogram(at(10_000_000, 12_000_000));
    const after = buildHistogram(at(10_000_000, 12_000_000, 998_000_000));
    expect(after[0].lo).toBe(before[0].lo);
    expect(after.slice(0, before.length).map((b) => b.hi)).toEqual(before.map((b) => b.hi));
  });

  it("coarsens to whole decades rather than dropping range when rungs overflow", () => {
    const buckets = buildHistogram(at(1, 1_000_000_000), 8);
    expect(buckets.length).toBeLessThanOrEqual(10);
    expect(buckets[0].lo).toBe(1);
    expect(buckets[buckets.length - 1].hi).toBeGreaterThanOrEqual(1_000_000_000);
    expect(buckets.every((b) => isDecadeEdge(b.lo))).toBe(true);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(2);
  });

  it("labels only whole powers of ten as decade edges", () => {
    expect(isDecadeEdge(100)).toBe(true);
    expect(isDecadeEdge(1_000_000)).toBe(true);
    expect(isDecadeEdge(200)).toBe(false);
    expect(isDecadeEdge(500)).toBe(false);
    expect(isDecadeEdge(0)).toBe(false);
  });

  it("returns nothing for an empty pool", () => {
    expect(buildHistogram([])).toEqual([]);
  });

  it("keeps the largest deposit in the last bucket", () => {
    const buckets = buildHistogram(at(1, 1_000), 4);
    expect(buckets[buckets.length - 1].count).toBe(1);
    expect(buckets.reduce((n, b) => n + b.count, 0)).toBe(2);
  });

  it("locates an amount, and reports -1 when it falls outside", () => {
    const buckets = buildHistogram(at(100, 1_000, 10_000), 3);
    expect(bucketIndexOf(buckets, 100)).toBe(0);
    expect(bucketIndexOf(buckets, 10_000)).toBe(buckets.length - 1);
    expect(bucketIndexOf(buckets, 1)).toBe(-1);
  });
});

describe("crowdNote", () => {
  const deposits = [10, 20, 50, 100, 200, 500, 1000, 2000].map((amount) => ({ amount, blockTime: 0 }));

  it("counts only deposits big enough to have funded the note", () => {
    expect(crowdNote(deposits, 60, "USDC")).toBe("5 USDC deposits are large enough to be this note.");
  });

  it("calls out a thin crowd, in the singular when it is one", () => {
    expect(crowdNote(deposits, 1500, "USDC")).toBe(
      "Thin crowd: only 1 USDC deposit is large enough to be this note.",
    );
  });

  it("no note without an amount", () => {
    expect(crowdNote(deposits, 0, "USDC")).toBeNull();
  });
});

describe("arrivals since a note", () => {
  const t = (amount: number, blockTime: number) => ({ amount, blockTime });

  it("counts only deposits strictly after the moment", () => {
    const deposits = [t(1, 100), t(1, 200), t(1, 300)];
    expect(countDepositsSince(deposits, 200_000)).toBe(1);
  });

  it("ignores deposits with no block time instead of dating them to 1970", () => {
    expect(countDepositsSince([t(1, 0), t(1, 0)], 0)).toBe(0);
  });

  it("reports an unjoined note through assessNote", () => {
    const created = 5_000_000;
    const alone = assessNote(100, created, [t(100, created / 1000 - 60)], created + 1);
    expect(alone.laterCount).toBe(0);
    expect(alone.isUnjoined).toBe(true);

    const joined = assessNote(100, created, [t(100, created / 1000 + 60)], created + 1);
    expect(joined.laterCount).toBe(1);
    expect(joined.isUnjoined).toBe(false);
  });
});

describe("daily activity", () => {
  const now = 1_000 * DAY_MS + 3_600_000; // mid-day on day 1000

  it("returns one bucket per day, oldest first, ending today", () => {
    const days = buildDailyActivity([], now, 14);
    expect(days).toHaveLength(14);
    expect(days[13].start).toBe(1_000 * DAY_MS);
    expect(days[0].start).toBe(987 * DAY_MS);
  });

  it("bins deposits into their UTC day and drops ones outside the window", () => {
    const deposits = [
      { amount: 1, blockTime: (999 * DAY_MS) / 1000 },
      { amount: 1, blockTime: (999 * DAY_MS + 7_200_000) / 1000 },
      { amount: 1, blockTime: (900 * DAY_MS) / 1000 }, // older than the window
      { amount: 1, blockTime: 0 }, // no block time
    ];
    const days = buildDailyActivity(deposits, now, 14);
    expect(days[12].count).toBe(2);
    expect(days.reduce((n, d) => n + d.count, 0)).toBe(2);
  });
});
