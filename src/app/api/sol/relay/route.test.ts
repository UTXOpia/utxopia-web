import { afterEach, describe, expect, it } from "bun:test";
import { Keypair } from "@solana/web3.js";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const originalRelayerKeypair = process.env.RELAYER_KEYPAIR;
const originalRelayerKeypairPath = process.env.RELAYER_KEYPAIR_PATH;

const { GET } = await import("./route");

describe("/api/sol/relay", () => {
  afterEach(() => {
    if (originalRelayerKeypair === undefined) {
      delete process.env.RELAYER_KEYPAIR;
    } else {
      process.env.RELAYER_KEYPAIR = originalRelayerKeypair;
    }
    if (originalRelayerKeypairPath === undefined) {
      delete process.env.RELAYER_KEYPAIR_PATH;
    } else {
      process.env.RELAYER_KEYPAIR_PATH = originalRelayerKeypairPath;
    }
  });

  it("returns the relayer pubkey from RELAYER_KEYPAIR_PATH", async () => {
    const relayer = Keypair.generate();
    const dir = mkdtempSync(join(tmpdir(), "utxopia-sol-relay-"));
    const keypairPath = join(dir, "id.json");
    writeFileSync(keypairPath, JSON.stringify(Array.from(relayer.secretKey)));

    try {
      delete process.env.RELAYER_KEYPAIR;
      process.env.RELAYER_KEYPAIR_PATH = keypairPath;

      const response = await GET();

      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({
        relayerPubkey: relayer.publicKey.toBase58(),
      });
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
