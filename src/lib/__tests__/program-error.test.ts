import { describe, expect, it } from "bun:test";
import { describeProgramError, programErrorCode } from "../program-error";
import { humanizeSpendError, INDEXER_LAG_MESSAGE } from "../indexer-lag-error";

describe("program errors", () => {
  it("reads the hex form the RPC actually returns", () => {
    // 0x1774 is the one the dry run put in front of a tester.
    expect(programErrorCode("Transaction simulation failed: custom program error: 0x1774")).toBe(6004);
  });

  it("reads the decimal forms other layers throw", () => {
    expect(programErrorCode('{"InstructionError":[0,{"Custom":6083}]}')).toBe(6083);
    expect(programErrorCode("Error Code: NullifierAlreadyUsed. Error Number: 6004")).toBe(6004);
  });

  it("ignores runtime error numbers below the Anchor range", () => {
    expect(programErrorCode('{"Custom":1}')).toBeNull();
    expect(describeProgramError(new Error("custom program error: 0x1"))).toBeNull();
  });

  it("explains a double-spend as stale state, not as lost funds", () => {
    const text = describeProgramError(new Error("custom program error: 0x1774"))!;
    expect(text).toContain("already been spent");
    expect(text).toContain("reload");
    expect(text).not.toContain("0x1774");
  });

  it("names an unmapped rejection instead of showing hex", () => {
    // 0x17ad = 6061 InvalidMint — real, but not something a member can act on.
    const text = describeProgramError(new Error("custom program error: 0x17ad"))!;
    expect(text).toContain("InvalidMint");
    expect(text).toContain("6061");
  });

  it("still names a code that predates this table", () => {
    const text = describeProgramError(new Error("custom program error: 0x1b58"))!;
    expect(text).toContain("7000");
  });

  it("leaves indexer lag to the lag message, which is a different failure", () => {
    expect(humanizeSpendError(new Error("Note 05aff021 not found on-chain"))).toBe(INDEXER_LAG_MESSAGE);
  });

  it("routes program errors through humanizeSpendError", () => {
    expect(humanizeSpendError(new Error("custom program error: 0x1774"))).toContain("already been spent");
  });

  it("passes anything unrecognised through untouched", () => {
    expect(humanizeSpendError(new Error("wallet disconnected"))).toBe("wallet disconnected");
  });
});
