import { describe, expect, test } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import * as web from "./pdas";
import * as sdk from "@utxopia/sdk";

/**
 * These helpers exist because the SDK's PDA functions are async (@solana/kit) while this app is
 * sync web3.js — they wrap the SDK's seed builders rather than restating seeds. That only holds
 * as long as nobody "fixes" one side by inlining a seed, which would derive a different address
 * with no error anywhere: the program would just reject an account that looks system-owned.
 *
 * So assert the two paths agree, rather than trusting that they still share a source.
 */
const PROG = new PublicKey("CvfSyACR8xemPdeJsB3D8Xh15rKUQ3b5c1PvnmABCBJp");
const BTC = new PublicKey("8hCSNKf8ByqZdet2D4SDiZHDrB1u9ohkhqKKzr9i7vfQ");
const POOL = new PublicKey("CeEEmE9MvFPZtqcgv1rsXmzNmfvchbs8VEZJGFKZ2Cyj");
const MINT = new PublicKey("Acxjj3uzWGLYZX4XiBU8HFjvjgLptvhwTN4PzHY2Qzey");
const USER = new PublicKey("uFBMJSxoGkHj2NyncPzAkhNWsGSQirQcRjUnGfEfWg1");
const H32 = new Uint8Array(32).fill(7);

const addr = (v: unknown) => (typeof v === "string" ? v : (v as PublicKey).toBase58());

describe("PDA parity: web wrappers vs SDK", () => {
  test.each([
    ["poolState",
      () => web.derivePoolStatePDA(PROG, MINT),
      () => sdk.derivePoolStatePDA(MINT.toBase58(), PROG.toBase58())],
    ["commitmentTree",
      () => web.deriveCommitmentTreePDA(PROG, 0, POOL),
      () => sdk.deriveCommitmentTreePDA(POOL.toBase58(), PROG.toBase58(), 0)],
    ["nullifier",
      () => web.deriveNullifierPDA(H32, POOL, 0, PROG),
      () => sdk.deriveNullifierRecordPDA(H32, POOL.toBase58(), 0, PROG.toBase58())],
    ["vkRegistry",
      () => web.deriveVkRegistryPDA(1, 1, PROG),
      () => sdk.deriveVkRegistryPDA(1, 1, PROG.toBase58())],
    ["tokenConfig",
      () => web.deriveTokenConfigPDA(MINT, PROG, POOL),
      () => sdk.deriveTokenConfigPDA(POOL.toBase58(), MINT.toBytes(), PROG.toBase58())],
    ["poolConfig",
      () => web.derivePoolConfigPDA(PROG, POOL),
      () => sdk.derivePoolConfigPDA(POOL.toBase58(), PROG.toBase58())],
    ["lightClient",
      () => web.deriveLightClientPDA(BTC),
      () => sdk.deriveLightClientPDA(BTC.toBase58())],
    ["blockHeader",
      () => web.deriveBlockHeaderPDA(H32, BTC),
      () => sdk.deriveBlockHeaderPDA(H32, BTC.toBase58())],
    ["heightIndex",
      () => web.deriveHeightIndexPDA(900n, BTC),
      () => sdk.deriveHeightIndexPDA(900n, BTC.toBase58())],
    ["depositReceipt",
      () => web.deriveDepositReceiptPDA(H32, PROG, 0),
      () => sdk.deriveDepositReceiptPDA(H32, 0, PROG.toBase58())],
  ])("%s derives the same address on both paths", async (_name, fromWeb, fromSdk) => {
    const mine = addr((fromWeb() as [PublicKey, number])[0]);
    const theirs = await fromSdk();
    expect(mine).toBe(addr(Array.isArray(theirs) ? theirs[0] : theirs));
  });

  test("redemption request agrees across the u64 nonce range", async () => {
    for (const nonce of [0n, 1n, 42n, 2n ** 64n - 1n]) {
      const [mine] = web.deriveRedemptionRequestPDA(USER, nonce, PROG, POOL);
      const [theirs] = await sdk.deriveRedemptionRequestPDA(
        POOL.toBase58(), USER.toBytes(), nonce, PROG.toBase58(),
      );
      expect(mine.toBase58()).toBe(addr(theirs));
    }
  });
});
