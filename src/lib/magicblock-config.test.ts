import { describe, expect, test } from "bun:test";
import {
  MAGICBLOCK_DEVNET_ROUTER_URL,
  MAGICBLOCK_DEVNET_ROUTER_WS_URL,
  assertMagicBlockClientConfig,
  getMagicBlockClientConfig,
  normalizeExecutionMode,
  normalizePrivacyDomain,
  normalizeValidatorRegion,
} from "./magicblock-config";

describe("MagicBlock client config", () => {
  test("defaults to normal Solana public domain", () => {
    const config = getMagicBlockClientConfig({});

    expect(config.executionMode).toBe("solana");
    expect(config.privacyDomain).toBe("public");
    expect(config.routerUrl).toBe(MAGICBLOCK_DEVNET_ROUTER_URL);
    expect(config.routerWsUrl).toBe(MAGICBLOCK_DEVNET_ROUTER_WS_URL);
    expect(config.validatorRegion).toBe("asia");
    expect(config.erUrl).toBeUndefined();
    expect(config.perUrl).toBeUndefined();
  });

  test("normalizes invalid execution modes to solana", () => {
    expect(normalizeExecutionMode(undefined)).toBe("solana");
    expect(normalizeExecutionMode("")).toBe("solana");
    expect(normalizeExecutionMode("invalid")).toBe("solana");
    expect(normalizeExecutionMode("ER")).toBe("er");
    expect(normalizeExecutionMode(" per ")).toBe("per");
  });

  test("supports only public and institution privacy domains", () => {
    expect(normalizePrivacyDomain("public")).toBe("public");
    expect(normalizePrivacyDomain(" Institution ")).toBe("institution");
    expect(normalizePrivacyDomain("partner-otc")).toBe("public");
    expect(normalizePrivacyDomain(undefined)).toBe("public");
  });

  test("normalizes validator regions with PER defaulting to TEE", () => {
    expect(normalizeValidatorRegion(undefined, "solana")).toBe("asia");
    expect(normalizeValidatorRegion(undefined, "per")).toBe("tee");
    expect(normalizeValidatorRegion("US", "er")).toBe("us");
    expect(normalizeValidatorRegion("invalid", "per")).toBe("tee");
  });

  test("requires an ER URL when ER mode is selected", () => {
    const config = getMagicBlockClientConfig({
      NEXT_PUBLIC_UTXOPIA_EXECUTION_MODE: "er",
    });

    expect(() => assertMagicBlockClientConfig(config)).toThrow(
      "NEXT_PUBLIC_MAGICBLOCK_ER_URL is required"
    );
  });

  test("requires a PER URL and non-public domain when PER mode is selected", () => {
    const missingUrl = getMagicBlockClientConfig({
      NEXT_PUBLIC_UTXOPIA_EXECUTION_MODE: "per",
      NEXT_PUBLIC_UTXOPIA_PRIVACY_DOMAIN: "institution",
    });

    expect(() => assertMagicBlockClientConfig(missingUrl)).toThrow(
      "NEXT_PUBLIC_MAGICBLOCK_PER_URL is required"
    );

    const publicPer = getMagicBlockClientConfig({
      NEXT_PUBLIC_UTXOPIA_EXECUTION_MODE: "per",
      NEXT_PUBLIC_UTXOPIA_PRIVACY_DOMAIN: "public",
      NEXT_PUBLIC_MAGICBLOCK_PER_URL: "https://per.example",
      MAGICBLOCK_PER_AUTH_TOKEN: "test-token",
    });

    expect(() => assertMagicBlockClientConfig(publicPer)).toThrow(
      "PER execution requires a non-public privacy domain"
    );

    const wrongValidator = getMagicBlockClientConfig({
      NEXT_PUBLIC_UTXOPIA_EXECUTION_MODE: "per",
      NEXT_PUBLIC_UTXOPIA_PRIVACY_DOMAIN: "institution",
      NEXT_PUBLIC_MAGICBLOCK_PER_URL: "https://per.example",
      NEXT_PUBLIC_MAGICBLOCK_VALIDATOR_REGION: "asia",
      MAGICBLOCK_PER_AUTH_TOKEN: "test-token",
    });

    expect(() => assertMagicBlockClientConfig(wrongValidator)).toThrow(
      "PER execution requires the TEE validator region"
    );
  });

  test("requires server-side PER authentication", () => {
    const config = getMagicBlockClientConfig({
      NEXT_PUBLIC_UTXOPIA_EXECUTION_MODE: "per",
      NEXT_PUBLIC_UTXOPIA_PRIVACY_DOMAIN: "institution",
      NEXT_PUBLIC_MAGICBLOCK_PER_URL: "https://per.example",
    });
    expect(() => assertMagicBlockClientConfig(config)).toThrow(
      "MAGICBLOCK_PER_AUTH_TOKEN"
    );
  });
});
