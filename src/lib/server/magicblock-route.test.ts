import { describe, expect, test } from "bun:test";
import { assertBackendCoordinatedPolicy } from "./magicblock-route";

describe("MagicBlock PER policy connection", () => {
  test("keeps disabled policy asset execution on Solana", () => {
    expect(assertBackendCoordinatedPolicy({
      policyMode: "disabled",
      privacyDomain: "public",
    })).toBe("solana");
  });

  test("keeps PER credentials and connections in the backend", () => {
    expect(assertBackendCoordinatedPolicy({
      policyMode: "per",
      privacyDomain: "institution",
    })).toBe("solana");
  });
});
