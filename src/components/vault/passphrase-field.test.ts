import { describe, expect, it } from "bun:test";
import { WORD_COUNT, GENERATED_WORD_COUNT, generatePassphrase } from "./passphrase-field";

// The generated passphrase is the only lock on a recovery string that the
// member is about to write down, so its entropy is a security parameter and
// belongs under test rather than in a comment.
describe("generated passphrase", () => {
  it("uses a word list whose length carries no modulo bias", () => {
    // 2^32 divides evenly by any power of two, so `% WORD_COUNT` over a uint32
    // is uniform. Any other length skews the first words of the list.
    expect(Number.isInteger(Math.log2(WORD_COUNT))).toBe(true);
  });

  it("has no duplicate words silently eating entropy", async () => {
    const { WORDS } = await import("./passphrase-field");
    expect(new Set(WORDS).size).toBe(WORDS.length);
  });

  it("carries at least 40 bits", () => {
    const bits = GENERATED_WORD_COUNT * Math.log2(WORD_COUNT);
    expect(bits).toBeGreaterThanOrEqual(40);
  });

  it("produces the advertised number of words", () => {
    expect(generatePassphrase().split(" ")).toHaveLength(GENERATED_WORD_COUNT);
  });

  it("does not repeat itself", () => {
    const seen = new Set(Array.from({ length: 50 }, generatePassphrase));
    expect(seen.size).toBe(50);
  });
});
