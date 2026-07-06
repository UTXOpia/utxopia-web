import { describe, it, expect, afterEach } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getRelayerKeypair } from "../relayer";

describe("getRelayerKeypair", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns null when RELAYER_KEYPAIR is not set", () => {
    delete process.env.RELAYER_KEYPAIR;
    delete process.env.RELAYER_KEYPAIR_PATH;
    expect(getRelayerKeypair()).toBeNull();
  });

  it("returns null when RELAYER_KEYPAIR is invalid JSON", () => {
    process.env.RELAYER_KEYPAIR = "not-json";
    expect(getRelayerKeypair()).toBeNull();
  });

  it("returns null when RELAYER_KEYPAIR is empty string", () => {
    process.env.RELAYER_KEYPAIR = "";
    delete process.env.RELAYER_KEYPAIR_PATH;
    expect(getRelayerKeypair()).toBeNull();
  });

  it("returns Keypair when RELAYER_KEYPAIR is valid", () => {
    // Generate a valid 64-byte secret key array (all 1s is not a valid key, use a known test vector)
    // Keypair.generate() internally, but we need deterministic — use a fixed secret
    const { Keypair } = require("@solana/web3.js");
    const testKeypair = Keypair.generate();
    process.env.RELAYER_KEYPAIR = JSON.stringify(Array.from(testKeypair.secretKey));

    const result = getRelayerKeypair();
    expect(result).not.toBeNull();
    expect(result!.publicKey.toBase58()).toBe(testKeypair.publicKey.toBase58());
  });

  it("returns Keypair when RELAYER_KEYPAIR_PATH points to a keypair file", () => {
    const { Keypair } = require("@solana/web3.js");
    const testKeypair = Keypair.generate();
    const dir = mkdtempSync(join(tmpdir(), "utxopia-relayer-"));
    const keypairPath = join(dir, "id.json");
    writeFileSync(keypairPath, JSON.stringify(Array.from(testKeypair.secretKey)));

    try {
      delete process.env.RELAYER_KEYPAIR;
      process.env.RELAYER_KEYPAIR_PATH = keypairPath;

      const result = getRelayerKeypair();
      expect(result).not.toBeNull();
      expect(result!.publicKey.toBase58()).toBe(testKeypair.publicKey.toBase58());
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("returns null when RELAYER_KEYPAIR_PATH cannot be read", () => {
    delete process.env.RELAYER_KEYPAIR;
    process.env.RELAYER_KEYPAIR_PATH = "/tmp/utxopia-missing-keypair.json";

    expect(getRelayerKeypair()).toBeNull();
  });
});
