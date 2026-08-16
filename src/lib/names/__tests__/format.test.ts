import { describe, expect, it } from "bun:test";
import { formatSnsFullName, formatSnsHandle } from "../format";
import { normalizeSnsSubdomain } from "../sns";

const SNS = { parentDomain: "utxopia" } as Parameters<typeof normalizeSnsSubdomain>[1];

describe("name display forms", () => {
  it("shows a handle and copies the canonical name", () => {
    expect(formatSnsHandle("milano")).toBe("@milano");
    expect(formatSnsFullName("milano", "utxopia")).toBe("milano.utxopia.sol");
  });

  it("does not double the prefix if one is already there", () => {
    expect(formatSnsHandle("@milano")).toBe("@milano");
    expect(formatSnsFullName("@milano", "utxopia")).toBe("milano.utxopia.sol");
  });

  it("round-trips through the resolver, so a displayed handle can be typed back in", () => {
    for (const name of ["milano", "alice", "capy-a1b2"]) {
      expect(normalizeSnsSubdomain(formatSnsHandle(name), SNS)).toBe(name);
      expect(normalizeSnsSubdomain(formatSnsFullName(name, "utxopia"), SNS)).toBe(name);
    }
  });
});
