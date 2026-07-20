import { describe, expect, it } from "bun:test";
import { POST } from "./route";

function request(body: Record<string, unknown>): Request {
  return new Request("https://app.utxopia.test/api/faucet/regtest?network=devnet-regtest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("regtest BTC deposit faucet", () => {
  it("rejects the legacy address field", async () => {
    const response = await POST(request({
      address: `utxo:${"11".repeat(96)}`,
      amountSats: 100_000,
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "stealthAddress must be a UTXOpia private address",
    });
  });

  it("rejects a raw regtest BTC recipient", async () => {
    const response = await POST(request({
      stealthAddress: `bcrt1q${"a".repeat(38)}`,
      amountSats: 100_000,
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "stealthAddress must be a UTXOpia private address",
    });
  });
});
