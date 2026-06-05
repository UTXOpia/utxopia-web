import { beforeEach, describe, expect, it, mock } from "bun:test";
import { getStealthDepositStatus, prepareStealthDeposit } from "../deposits";

const mockFetch = mock(() => Promise.resolve({} as Response));
global.fetch = mockFetch as any;

describe("stealth deposit API helpers", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("prepares stealth deposits through the prepare route", async () => {
    const response = {
      success: true,
      deposit_id: "stealth_1",
      btc_address: "tb1ptest",
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    } as any);

    await expect(prepareStealthDeposit("aa", "bb")).resolves.toEqual(response);

    const [url, init] = mockFetch.mock.calls[0] as any[];
    expect(url).toBe("/api/stealth/prepare");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ viewing_pub: "aa", spending_pub: "bb" });
  });

  it("fetches stealth deposit status from the backend status route", async () => {
    const response = {
      id: "stealth/needs encoding",
      status: "ready",
      btc_address: "tb1ptest",
      ephemeral_pub: "ephemeral",
      confirmations: 6,
      sweep_confirmations: 6,
      created_at: 1,
      updated_at: 2,
      expires_at: 3,
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => response,
    } as any);

    await expect(getStealthDepositStatus("stealth/needs encoding")).resolves.toEqual(response);

    const [url, init] = mockFetch.mock.calls[0] as any[];
    expect(url).toBe("/api/stealth/status/stealth%2Fneeds%20encoding");
    expect(init.method).toBe("GET");
  });
});
