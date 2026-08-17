import { describe, expect, it } from "bun:test";
import { planTokenScanFor, scanByTokenPlan } from "../chain-inbox";
import { toHex64 } from "../utils/hex";

type Ann = { leafIndex: number; tokenIdHex?: string };

const ZKBTC = 0x11n;
const ZKSOL = 0x22n;
const configured = [
  { symbol: "zkBTC", tokenId: ZKBTC },
  { symbol: "zkSOL", tokenId: ZKSOL },
];

const ann = (leafIndex: number, tokenId?: bigint): Ann => ({
  leafIndex,
  tokenIdHex: tokenId === undefined ? undefined : toHex64(tokenId),
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- the planner only reads leafIndex/tokenIdHex
const plan = (rows: Ann[]) => planTokenScanFor(configured, rows as any);
const leaves = (group: { announcements: Array<{ leafIndex: number }> }) =>
  group.announcements.map((a) => a.leafIndex);

describe("planTokenScanFor", () => {
  it("scans a row tagged with a known token under that token alone", () => {
    const groups = plan([ann(0, ZKBTC), ann(1, ZKSOL)]);

    expect(groups.map((g) => g.symbol)).toEqual(["zkBTC", "zkSOL"]);
    expect(leaves(groups[0])).toEqual([0]);
    expect(leaves(groups[1])).toEqual([1]);
  });

  // The indexer leaves token_id all-zero on most transfers, and a zero is not a
  // token — those rows have to keep going through every configured token.
  it("sends untagged and zero-tagged rows through every configured token", () => {
    const groups = plan([ann(0), ann(1, 0n), ann(2, ZKBTC)]);

    expect(leaves(groups[0])).toEqual([2, 0, 1]);
    expect(leaves(groups[1])).toEqual([0, 1]);
  });

  // An id we don't recognise can't be trusted to say what the commitment was
  // built with, so the row is tried both ways rather than only its own.
  it("tries an unrecognised token id and the configured set", () => {
    const groups = plan([ann(0, 0x99n)]);

    expect(groups.map((g) => leaves(g))).toEqual([[0], [0], [0]]);
    expect(groups.at(-1)?.tokenId).toBe(0x99n);
  });

  it("drops configured tokens with nothing to scan", () => {
    expect(plan([ann(0, ZKBTC)]).map((g) => g.symbol)).toEqual(["zkBTC"]);
  });

  // The point of the split: one pass over the feed, not one per token id.
  it("costs one trial-decrypt per row when every row is tagged", () => {
    const rows = [ann(0, ZKBTC), ann(1, ZKBTC), ann(2, ZKSOL)];
    const scanned = plan(rows).reduce((n, g) => n + g.announcements.length, 0);

    expect(scanned).toBe(rows.length);
  });
});

describe("scanByTokenPlan", () => {
  it("labels each leaf with the first token that claims it", async () => {
    const groups = plan([ann(0), ann(1, ZKSOL)]);
    const found = await scanByTokenPlan(groups, async (rows) =>
      rows.map((row) => ({ leafIndex: row.leafIndex })),
    );

    expect(found).toEqual([
      { leafIndex: 0, tokenSymbol: "zkBTC" },
      { leafIndex: 1, tokenSymbol: "zkSOL" },
    ]);
  });

  it("skips leaves the caller already holds", async () => {
    const groups = plan([ann(0, ZKBTC), ann(1, ZKSOL)]);
    const found = await scanByTokenPlan(
      groups,
      async (rows) => rows.map((row) => ({ leafIndex: row.leafIndex })),
      new Set([0]),
    );

    expect(found.map((n) => n.leafIndex)).toEqual([1]);
  });
});
