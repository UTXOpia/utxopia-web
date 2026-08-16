import { describe, expect, it } from "bun:test";
import { formatSnsFullName } from "../format";
import { normalizeSnsSubdomain } from "../sns";

const SNS = { parentDomain: "utxopia" } as Parameters<typeof normalizeSnsSubdomain>[1];

describe("receive name display", () => {
  it("builds the canonical name", () => {
    expect(formatSnsFullName("milano", "utxopia")).toBe("milano.utxopia.sol");
  });

  it("tolerates a value that arrived in @ form", () => {
    expect(formatSnsFullName("@milano", "utxopia")).toBe("milano.utxopia.sol");
  });

  it("round-trips through the resolver, so what is shown can be typed back in", () => {
    for (const name of ["milano", "alice", "capy-a1b2"]) {
      expect(normalizeSnsSubdomain(formatSnsFullName(name, "utxopia"), SNS)).toBe(name);
    }
  });
});
