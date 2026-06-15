import { describe, it, expect } from "bun:test";
import { validateViewingKeyHex, hexToBytes32 } from "../auditor-key-input";
import { formatBigintAmount } from "../auditor-records-table";

// ---------------------------------------------------------------------------
// validateViewingKeyHex
// ---------------------------------------------------------------------------

describe("validateViewingKeyHex", () => {
  it("returns null for empty string (no error yet)", () => {
    expect(validateViewingKeyHex("")).toBeNull();
  });

  it("accepts a valid 64-char lowercase hex string", () => {
    const valid = "a".repeat(64);
    expect(validateViewingKeyHex(valid)).toBeNull();
  });

  it("accepts a valid 64-char uppercase hex string", () => {
    const valid = "A".repeat(64);
    expect(validateViewingKeyHex(valid)).toBeNull();
  });

  it("accepts a 0x-prefixed 64-char hex string", () => {
    const valid = "0x" + "f".repeat(64);
    expect(validateViewingKeyHex(valid)).toBeNull();
  });

  it("rejects non-hex characters", () => {
    const err = validateViewingKeyHex("g".repeat(64));
    expect(err).not.toBeNull();
    expect(err).toMatch(/hex/i);
  });

  it("rejects a 63-char hex string (too short)", () => {
    const err = validateViewingKeyHex("a".repeat(63));
    expect(err).not.toBeNull();
    expect(err).toMatch(/64/);
  });

  it("rejects a 65-char hex string (too long)", () => {
    const err = validateViewingKeyHex("a".repeat(65));
    expect(err).not.toBeNull();
    expect(err).toMatch(/64/);
  });
});

// ---------------------------------------------------------------------------
// hexToBytes32
// ---------------------------------------------------------------------------

describe("hexToBytes32", () => {
  it("converts a 64-char hex string to 32 bytes", () => {
    const hex = "00".repeat(32);
    const bytes = hexToBytes32(hex);
    expect(bytes.length).toBe(32);
    expect(bytes.every((b) => b === 0)).toBe(true);
  });

  it("converts ff…ff correctly", () => {
    const hex = "ff".repeat(32);
    const bytes = hexToBytes32(hex);
    expect(bytes.length).toBe(32);
    expect(bytes.every((b) => b === 0xff)).toBe(true);
  });

  it("handles 0x prefix", () => {
    const hex = "0x" + "ab".repeat(32);
    const bytes = hexToBytes32(hex);
    expect(bytes.length).toBe(32);
    expect(bytes[0]).toBe(0xab);
  });

  it("round-trips a known value", () => {
    const hex = "0102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f20";
    const bytes = hexToBytes32(hex);
    expect(bytes[0]).toBe(0x01);
    expect(bytes[31]).toBe(0x20);
  });
});

// ---------------------------------------------------------------------------
// formatBigintAmount
// ---------------------------------------------------------------------------

describe("formatBigintAmount", () => {
  it("returns '0' for zero amount", () => {
    expect(formatBigintAmount(0n)).toBe("0");
  });

  it("formats 1 satoshi as 0.00000001", () => {
    expect(formatBigintAmount(1n)).toBe("0.00000001");
  });

  it("formats 100_000_000 sats as 1", () => {
    expect(formatBigintAmount(100_000_000n)).toBe("1");
  });

  it("formats 50_000_000 sats as 0.5", () => {
    expect(formatBigintAmount(50_000_000n)).toBe("0.5");
  });

  it("formats 12_345_678 sats correctly", () => {
    expect(formatBigintAmount(12_345_678n)).toBe("0.12345678");
  });

  it("trims trailing zeros in fractional part", () => {
    expect(formatBigintAmount(10_000_000n)).toBe("0.1");
  });

  it("handles large amounts (> 21M BTC in sats)", () => {
    // 21M BTC = 2_100_000_000_000_000 sats
    expect(formatBigintAmount(2_100_000_000_000_000n)).toBe("21000000");
  });

  it("respects custom decimals", () => {
    // 6 decimals (USDC-like): 1_000_000 = 1.0
    expect(formatBigintAmount(1_000_000n, 6)).toBe("1");
    expect(formatBigintAmount(500_000n, 6)).toBe("0.5");
  });
});
