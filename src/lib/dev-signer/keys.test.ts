// web/src/lib/dev-signer/keys.test.ts
import { test, expect, afterEach } from "bun:test";
import { loadDevKeys, DEV_KEYS_STORAGE_KEY } from "./keys";

const FULL = { solanaSecretKeyB58: "S", btcWif: "B", utxopiaSeedHex: "00" };

function stubLocalStorage(raw: string | null) {
  (globalThis as Record<string, unknown>).localStorage = {
    getItem: (k: string) => (k === DEV_KEYS_STORAGE_KEY ? raw : null),
  };
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>).__UTXOPIA_DEV_KEYS;
  delete (globalThis as Record<string, unknown>).localStorage;
  for (const k of ["NEXT_PUBLIC_DEV_SOLANA_SK","NEXT_PUBLIC_DEV_BTC_WIF","NEXT_PUBLIC_DEV_UTXOPIA_SEED"]) delete process.env[k];
});

test("runtime injection takes precedence", () => {
  (globalThis as Record<string, unknown>).__UTXOPIA_DEV_KEYS = {
    solanaSecretKeyB58: "S", btcWif: "B", utxopiaSeedHex: "00",
  };
  process.env.NEXT_PUBLIC_DEV_SOLANA_SK = "ENV";
  expect(loadDevKeys()?.solanaSecretKeyB58).toBe("S");
});

test("falls back to env vars", () => {
  process.env.NEXT_PUBLIC_DEV_SOLANA_SK = "S";
  process.env.NEXT_PUBLIC_DEV_BTC_WIF = "B";
  process.env.NEXT_PUBLIC_DEV_UTXOPIA_SEED = "00";
  expect(loadDevKeys()?.btcWif).toBe("B");
});

test("reads complete keys from localStorage", () => {
  stubLocalStorage(JSON.stringify(FULL));
  expect(loadDevKeys()?.solanaSecretKeyB58).toBe("S");
});

test("globalThis injection beats localStorage", () => {
  (globalThis as Record<string, unknown>).__UTXOPIA_DEV_KEYS = { ...FULL, btcWif: "INJECTED" };
  stubLocalStorage(JSON.stringify(FULL));
  expect(loadDevKeys()?.btcWif).toBe("INJECTED");
});

test("ignores incomplete localStorage and malformed JSON", () => {
  stubLocalStorage(JSON.stringify({ solanaSecretKeyB58: "S" }));
  expect(loadDevKeys()).toBeNull();
  stubLocalStorage("not json");
  expect(loadDevKeys()).toBeNull();
});

test("returns null when nothing provided", () => {
  expect(loadDevKeys()).toBeNull();
});
