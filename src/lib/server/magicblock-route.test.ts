import { describe, expect, test } from "bun:test";
import { Keypair, PublicKey } from "@solana/web3.js";
import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  assertDelegatedExecutionCluster,
  buildMagicBlockAtomicCommitInstruction,
  createMagicBlockExecutionConnections,
} from "./magicblock-route";
import type { MagicBlockClientConfig } from "@/lib/magicblock-config";

const baseConfig: MagicBlockClientConfig = {
  executionMode: "solana",
  privacyDomain: "public",
  routerUrl: "https://devnet-router.magicblock.app",
  routerWsUrl: "wss://devnet-router.magicblock.app",
  validatorRegion: "asia",
};

describe("MagicBlock server routing", () => {
  test("keeps normal Solana execution on the base connection", () => {
    const connections = createMagicBlockExecutionConnections(
      "https://api.devnet.solana.com",
      baseConfig
    );
    expect(connections.usesRouter).toBe(false);
    expect(connections.execution).toBe(connections.base);
  });

  test("uses Magic Router for ER and fails closed without its endpoint", () => {
    const config: MagicBlockClientConfig = {
      ...baseConfig,
      executionMode: "er",
      erUrl: "https://er.example",
    };
    const connections = createMagicBlockExecutionConnections(
      "https://api.devnet.solana.com",
      config
    );
    expect(connections.usesRouter).toBe(true);
    expect(connections.execution).toBeInstanceOf(ConnectionMagicRouter);
  });

  test("encodes the complete atomic commit cluster", () => {
    const programId = Keypair.generate().publicKey;
    const payer = Keypair.generate().publicKey;
    const poolState = Keypair.generate().publicKey;
    const commitmentTree = Keypair.generate().publicKey;
    const nullifiers = [Keypair.generate().publicKey, Keypair.generate().publicKey];
    const hashes = [new Uint8Array(32).fill(1), new Uint8Array(32).fill(2)];

    const instruction = buildMagicBlockAtomicCommitInstruction({
      programId,
      payer,
      poolState,
      commitmentTree,
      nullifierAccounts: nullifiers,
      nullifierHashes: hashes,
    });

    expect(Array.from(instruction.data.subarray(0, 4))).toEqual([33, 1, 0, 2]);
    expect(instruction.data.subarray(4, 36)).toEqual(Buffer.from(hashes[0]));
    expect(instruction.keys.map((key) => key.pubkey.toBase58()).slice(4)).toEqual([
      poolState.toBase58(),
      commitmentTree.toBase58(),
      ...nullifiers.map((key) => key.toBase58()),
    ]);
  });

  test("rejects a partially delegated execution cluster", async () => {
    const connection = {
      getDelegationStatus: async (account: PublicKey) => ({
        isDelegated: account.toBuffer()[0] !== 0,
      }),
    } as unknown as ConnectionMagicRouter;
    const pool = new PublicKey(new Uint8Array(32));
    const tree = Keypair.generate().publicKey;

    await expect(
      assertDelegatedExecutionCluster(connection, pool, tree, "er")
    ).rejects.toThrow("both pool and active tree");
  });
});
