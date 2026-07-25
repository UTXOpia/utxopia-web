import { describe, expect, it } from "bun:test";
import { computeBpsFee, feeShareBps, parsePoolFees } from "../pool-fees";

describe("pool fees", () => {
  it("parses deposit and withdrawal fees from PoolState", () => {
    const data = new Uint8Array(268);
    data[0] = 1;
    new DataView(data.buffer).setUint16(244, 20, true);
    new DataView(data.buffer).setUint16(246, 20, true);
    expect(parsePoolFees(data)).toEqual({ depositFeeBps: 20, withdrawalFeeBps: 20 });
  });

  it("matches the on-chain withdrawal floor with minimum one", () => {
    expect(computeBpsFee(10_000_000n, 20)).toBe(20_000n);
    expect(computeBpsFee(9_980_000n, 20)).toBe(19_960n);
    expect(computeBpsFee(1n, 20)).toBe(1n);
    expect(feeShareBps(19_960n, 9_980_000n)).toBe(20);
  });

  it("charges at least one base unit for configured deposit fees", () => {
    expect(computeBpsFee(1n, 20)).toBe(1n);
    expect(computeBpsFee(10_000n, 20)).toBe(20n);
  });
});
