import { describe, expect, it } from "bun:test";
import {
  assessNote,
  bucketIndexOf,
  buildHistogram,
  countExactDeposits,
  countSimilarDeposits,
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

  it("collapses to one bucket when every deposit is the same size", () => {
    expect(buildHistogram(at(500, 500, 500))).toEqual([{ lo: 500, hi: 500, count: 3 }]);
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
