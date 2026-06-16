// web/src/lib/dev-signer/enabled.test.ts
import { test, expect, afterEach } from "bun:test";
import { isDevSignerEnabled, assertDevSignerSafe } from "./enabled";

afterEach(() => { delete process.env.NEXT_PUBLIC_DEV_SIGNER; });

test("disabled when flag absent", () => {
  expect(isDevSignerEnabled()).toBe(false);
});

test("disabled when flag is not exactly '1'", () => {
  process.env.NEXT_PUBLIC_DEV_SIGNER = "true";
  expect(isDevSignerEnabled()).toBe(false);
});

test("enabled when flag is '1'", () => {
  process.env.NEXT_PUBLIC_DEV_SIGNER = "1";
  expect(isDevSignerEnabled()).toBe(true);
});

test("assertDevSignerSafe throws on any mainnet network id", () => {
  expect(() => assertDevSignerSafe("mainnet")).toThrow();
  expect(() => assertDevSignerSafe("sui-mainnet")).toThrow();
});

test("assertDevSignerSafe passes on dev/test networks", () => {
  expect(() => assertDevSignerSafe("devnet")).not.toThrow();
  expect(() => assertDevSignerSafe("sui-testnet")).not.toThrow();
  expect(() => assertDevSignerSafe("devnet-regtest")).not.toThrow();
});
