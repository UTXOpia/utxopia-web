import { describe, expect, it } from "bun:test";
import { formatPrivateReceiveName, normalizePrivateNameHandle } from "./private-name-claim";

describe("private receive name normalization", () => {
  it("normalizes Solana handles and full names", () => {
    expect(normalizePrivateNameHandle("@alice", "solana")).toBe("alice");
    expect(normalizePrivateNameHandle("alice.utxopia.sol", "solana")).toBe("alice");
    expect(formatPrivateReceiveName("@alice", "solana")).toBe("alice.utxopia.sol");
  });

  // SNS would take a hyphen; a name that gets read aloud and retyped from a
  // screenshot should not. It also keeps `alice-1` from being claimed as a
  // lookalike of `alice1`.
  it("rejects hyphens, so a name survives being retyped", () => {
    expect(() => normalizePrivateNameHandle("alice-1", "solana")).toThrow(/no hyphens/);
    expect(() => formatPrivateReceiveName("alice-1", "solana")).toThrow(/no hyphens/);
  });

  it("rejects what a name can't carry", () => {
    expect(() => normalizePrivateNameHandle("alice bob", "solana")).toThrow();
    expect(() => normalizePrivateNameHandle("", "solana")).toThrow();
    expect(() => normalizePrivateNameHandle("a".repeat(33), "solana")).toThrow();
  });
});
