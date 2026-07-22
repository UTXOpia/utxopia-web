import { describe, expect, it } from "bun:test";
import { POST } from "./route";

function request(body: Record<string, unknown>): Request {
  return new Request("https://app.utxopia.test/api/faucet/btc?network=devnet-regtest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("native regtest BTC faucet", () => {
  it("rejects a non-regtest address before contacting the backend", async () => {
    const response = await POST(request({ address: "bc1qnotregtest", amountSats: 10_000 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "enter a valid regtest BTC address" });
  });

  it("enforces the native BTC amount cap before contacting the backend", async () => {
    const response = await POST(request({ address: `bcrt1q${"a".repeat(38)}`, amountSats: 100_001 }));
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ ok: false, error: "amount must be 1–100,000 sats" });
  });
});
