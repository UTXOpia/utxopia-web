import { describe, expect, test } from "bun:test";
import { accountScopedSeed } from "./account-seed";

const seed = new Uint8Array(32).fill(7);

describe("accountScopedSeed", () => {
  test("index 0 is the identity — existing notes must stay spendable", async () => {
    expect(await accountScopedSeed(seed, 0)).toBe(seed);
  });

  test("non-zero indices diverge from index 0 and from each other", async () => {
    const [a, b, c] = await Promise.all([
      accountScopedSeed(seed, 0),
      accountScopedSeed(seed, 1),
      accountScopedSeed(seed, 2),
    ]);
    expect(b).not.toEqual(a);
    expect(c).not.toEqual(a);
    expect(c).not.toEqual(b);
  });

  test("deterministic — recovery on a new device re-derives the same account", async () => {
    expect(await accountScopedSeed(seed, 3)).toEqual(await accountScopedSeed(seed, 3));
  });

  test("index 11 is not index 1 with a stray digit (domain is length-safe)", async () => {
    expect(await accountScopedSeed(seed, 11)).not.toEqual(await accountScopedSeed(seed, 1));
  });

  test("rejects junk indices instead of silently deriving a stray identity", async () => {
    for (const bad of [-1, 1.5, NaN]) {
      expect(accountScopedSeed(seed, bad)).rejects.toThrow();
    }
  });
});
