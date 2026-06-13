import { afterEach, describe, expect, it } from "bun:test";
import { Connection, Keypair } from "@solana/web3.js";
import { POST } from "./route";

const originalEnv = { ...process.env };
const originalGetAccountInfo = Connection.prototype.getAccountInfo;
const originalGetMinimumBalanceForRentExemption = Connection.prototype.getMinimumBalanceForRentExemption;
const originalGetLatestBlockhash = Connection.prototype.getLatestBlockhash;

afterEach(() => {
  process.env = { ...originalEnv };
  Connection.prototype.getAccountInfo = originalGetAccountInfo;
  Connection.prototype.getMinimumBalanceForRentExemption = originalGetMinimumBalanceForRentExemption;
  Connection.prototype.getLatestBlockhash = originalGetLatestBlockhash;
});

describe("/api/sns/register", () => {
  it("prepares a parent-owner direct registration when the sub-registrar account is missing", async () => {
    const relayer = Keypair.generate();
    const owner = Keypair.generate();
    process.env.RELAYER_KEYPAIR = JSON.stringify(Array.from(relayer.secretKey));

    const parentData = Buffer.alloc(96);
    relayer.publicKey.toBuffer().copy(parentData, 32);
    let getAccountInfoCalls = 0;

    Connection.prototype.getAccountInfo = async function () {
      getAccountInfoCalls += 1;
      if (getAccountInfoCalls === 1) return { data: parentData } as never;
      return null;
    };
    Connection.prototype.getMinimumBalanceForRentExemption = async function () {
      return 1_000_000;
    };
    Connection.prototype.getLatestBlockhash = async function () {
      return {
        blockhash: "11111111111111111111111111111111",
        lastValidBlockHeight: 123,
      };
    };

    const stealthData = `02${"11".repeat(32)}${"22".repeat(32)}`;
    const response = await POST(new Request("https://app.utxopia.test/api/sns/register?network=devnet-regtest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `192.0.2.${Math.floor(Math.random() * 200) + 1}`,
      },
      body: JSON.stringify({
        action: "prepare",
        name: "alice",
        owner: owner.publicKey.toBase58(),
        stealthData,
      }),
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.mode).toBe("parent-owner-direct");
    expect(body.relayer).toBe(relayer.publicKey.toBase58());
    expect(typeof body.transaction).toBe("string");
    expect(body.transaction.length).toBeGreaterThan(100);
    expect(getAccountInfoCalls).toBe(3);
  });

  it("returns a clear error when no relayer key is configured", async () => {
    delete process.env.RELAYER_KEYPAIR;

    const response = await POST(new Request("https://app.utxopia.test/api/sns/register?network=devnet-regtest", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
      },
      body: JSON.stringify({
        action: "prepare",
        name: "alice",
        owner: Keypair.generate().publicKey.toBase58(),
        stealthData: `02${"11".repeat(32)}${"22".repeat(32)}`,
      }),
    }) as never);
    const body = await response.json();

    expect(response.status).toBe(503);
    expect(body.success).toBe(false);
    expect(body.relayerUnavailable).toBe(true);
  });
});
