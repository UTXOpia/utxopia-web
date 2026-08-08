import { describe, expect, it } from "bun:test";
import {
  INDEXER_LAG_MESSAGE,
  humanizeSpendError,
  isIndexerLagError,
} from "../indexer-lag-error";

describe("indexer lag errors", () => {
  // The exact strings seen in production. If the circuit or the SDK reword
  // these, this test is where it should surface — not in a member's face.
  const REAL_LAG_ERRORS = [
    "Error: Assert Failed. Error in template JoinSplit_322 line: 124",
    "Assert Failed. Error in template JoinSplit_1024 line: 124",
    "Note 05aff021de54be12... not found on-chain",
    "Commitment tree account not found on-chain",
  ];

  it("recognises every way a stale indexer surfaces", () => {
    for (const raw of REAL_LAG_ERRORS) {
      expect(isIndexerLagError(raw)).toBe(true);
      expect(humanizeSpendError(new Error(raw))).toBe(INDEXER_LAG_MESSAGE);
    }
  });

  it("tells the member their funds did not move", () => {
    // The whole point: the raw error reads like the money is gone.
    expect(INDEXER_LAG_MESSAGE).toContain("Nothing was submitted");
    expect(INDEXER_LAG_MESSAGE).toContain("Try again");
  });

  it("passes unrelated failures through untouched", () => {
    // Rewriting these would tell someone to "try again later" about a problem
    // that retrying cannot fix.
    const others = [
      "No available private notes can cover this amount",
      "Could not fetch the Verified Privacy relayer",
      "Simulation failed. Message: Transaction simulation failed",
    ];
    for (const raw of others) {
      expect(isIndexerLagError(raw)).toBe(false);
      expect(humanizeSpendError(new Error(raw))).toBe(raw);
    }

    // A program rejection is not lag either, but it is no longer passed through
    // raw — see program-error.ts. Retrying does not fix it, and the replacement
    // text says so rather than suggesting a wait.
    expect(isIndexerLagError("custom program error: 0x1774")).toBe(false);
    expect(humanizeSpendError(new Error("custom program error: 0x1774"))).not.toContain("0x1774");
  });

  it("never renders an empty error", () => {
    expect(humanizeSpendError(new Error(""))).toBe("Transaction failed");
    expect(humanizeSpendError(undefined)).toBe("Transaction failed");
  });

  it("handles a thrown non-Error", () => {
    expect(humanizeSpendError("Note abc123... not found on-chain")).toBe(INDEXER_LAG_MESSAGE);
  });
});
