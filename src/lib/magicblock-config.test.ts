import { describe, expect, test } from "bun:test";
import {
  assertMagicBlockPolicyConfig,
  getMagicBlockPolicyConfig,
  normalizePolicyMode,
  normalizePrivacyDomain,
} from "./magicblock-config";

describe("MagicBlock PER policy config", () => {
  test("defaults to disabled and keeps asset execution out of config", () => {
    const config = getMagicBlockPolicyConfig({});

    expect(config.policyMode).toBe("disabled");
    expect(config.privacyDomain).toBe("public");
    expect(config.perUrl).toBeUndefined();
    expect("executionMode" in config).toBe(false);
  });

  test("normalizes policy mode and privacy domain", () => {
    expect(normalizePolicyMode(undefined)).toBe("disabled");
    expect(normalizePolicyMode("ER")).toBe("disabled");
    expect(normalizePolicyMode(" per ")).toBe("per");
    expect(normalizePrivacyDomain(" Institution ")).toBe("institution");
    expect(normalizePrivacyDomain("other")).toBe("public");
  });

  test("requires an institution domain for backend-coordinated PER policy", () => {
    const publicPer = getMagicBlockPolicyConfig({
      MAGICBLOCK_POLICY_MODE: "per",
    });
    expect(() => assertMagicBlockPolicyConfig(publicPer)).toThrow(
      "institution privacy domain"
    );
  });

  test("accepts backend-coordinated PER without exposing endpoint credentials", () => {
    const config = getMagicBlockPolicyConfig({
      MAGICBLOCK_POLICY_MODE: "per",
      NEXT_PUBLIC_UTXOPIA_PRIVACY_DOMAIN: "institution",
    });

    expect(() => assertMagicBlockPolicyConfig(config)).not.toThrow();
    expect("perUrl" in config).toBe(false);
    expect("perAuthToken" in config).toBe(false);
  });
});
