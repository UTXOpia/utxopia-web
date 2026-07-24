import { describe, expect, it } from "bun:test";
import { estimateJoinSplitDimensions } from "./join-split-dimensions";

describe("estimateJoinSplitDimensions", () => {
  it("predicts recipient, fee, and change outputs", () => {
    expect(estimateJoinSplitDimensions([94_300n], 2_000n, 500n)).toEqual({
      nInputs: 1,
      nOutputs: 3,
    });
  });

  it("omits change when selected notes exactly cover amount plus fee", () => {
    expect(estimateJoinSplitDimensions([2_500n], 2_000n, 500n)).toEqual({
      nInputs: 1,
      nOutputs: 2,
    });
  });

  it("supports multiple inputs and no relayer fee", () => {
    expect(estimateJoinSplitDimensions([1_000n, 2_000n], 2_500n, 0n)).toEqual({
      nInputs: 2,
      nOutputs: 2,
    });
  });

  it("does not preload for invalid or insufficient selections", () => {
    expect(estimateJoinSplitDimensions([], 1n, 0n)).toBeNull();
    expect(estimateJoinSplitDimensions([100n], 101n, 0n)).toBeNull();
    expect(estimateJoinSplitDimensions([100n], 1n, -1n)).toBeNull();
  });
});
