import { describe, expect, it } from "bun:test";
import type { InboxNote } from "@/stores/utxopia-store";
import { autoSelectNotes } from "./helpers";

function note(id: string, amount: bigint): InboxNote {
  return {
    id,
    amount,
    ephemeralPub: new Uint8Array(32),
    leafIndex: 0,
    commitment: new Uint8Array(32),
    commitmentHex: "00".repeat(32),
    createdAt: 0,
    isSpent: false,
    tokenSymbol: "zkBTC",
  };
}

describe("autoSelectNotes", () => {
  it("minimizes JoinSplit inputs by selecting the largest notes first", () => {
    const selected = autoSelectNotes([
      note("small-a", 20n),
      note("large", 100n),
      note("small-b", 30n),
    ], 90);

    expect([...selected]).toEqual(["large"]);
  });

  it("adds the next-largest note only when one note cannot cover the target", () => {
    const selected = autoSelectNotes([
      note("a", 60n),
      note("b", 50n),
      note("c", 40n),
    ], 100);

    expect([...selected]).toEqual(["a", "b"]);
  });

  it("selects nothing for a non-positive target", () => {
    expect(autoSelectNotes([note("a", 100n)], 0).size).toBe(0);
  });
});
