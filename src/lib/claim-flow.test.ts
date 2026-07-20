import { describe, expect, it } from "bun:test";
import {
  calculateClaimReceiveAmount,
  selectUnspentClaimNote,
} from "./claim-flow";

describe("claim flow", () => {
  it("selects an unspent note when older matches are already spent", () => {
    const note = selectUnspentClaimNote([
      { id: "spent", isSpent: true },
      { id: "live", isSpent: false },
    ]);
    expect(note.id).toBe("live");
  });

  it("distinguishes redeemed links from unknown links", () => {
    expect(() => selectUnspentClaimNote([{ isSpent: true }])).toThrow("already been redeemed");
    expect(() => selectUnspentClaimNote([])).toThrow("No private note was found");
  });

  it("subtracts the relay fee and rejects uneconomic notes", () => {
    expect(calculateClaimReceiveAmount(100_000, 500)).toBe(99_500n);
    expect(() => calculateClaimReceiveAmount(500, 500)).toThrow("too small");
  });
});
