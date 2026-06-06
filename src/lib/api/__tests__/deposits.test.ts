import { beforeEach, describe, expect, it, mock } from "bun:test";
import {
  fetchAllDeposits,
  getDepositStatus,
  getStealthDepositStatus,
  prepareStealthDeposit,
  registerDeposit,
  subscribeToDepositStatus,
} from "../deposits";

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

describe("deposit network routing", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("adds explicit network query params to tracker HTTP calls", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, deposits: [] }),
    } as any);

    await fetchAllDeposits("sui-regtest");
    await getDepositStatus("deposit_1", "devnet-regtest");
    await registerDeposit("bcrt1ptest", "aa", 10_000, "bb", "sui-regtest");

    expect(mockFetch.mock.calls[0][0]).toBe("/api/deposits?network=sui-regtest");
    expect(mockFetch.mock.calls[1][0]).toBe("/api/deposits/deposit_1?network=devnet-regtest");
    expect(mockFetch.mock.calls[2][0]).toBe("/api/deposits?network=sui-regtest");
    expect(JSON.parse((mockFetch.mock.calls[2][1] as RequestInit).body as string)).toEqual({
      taproot_address: "bcrt1ptest",
      note_public_key: "aa",
      amount_sats: 10_000,
      ephemeral_pubkey: "bb",
    });
  });

  it("uses the selected network backend for deposit status WebSockets", () => {
    const originalWebSocket = global.WebSocket;
    const sockets: string[] = [];
    class MockWebSocket {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: Event) => void) | null = null;
      onclose: ((event: CloseEvent) => void) | null = null;
      onopen: (() => void) | null = null;

      constructor(url: string) {
        sockets.push(url);
      }

      close() {}
    }
    global.WebSocket = MockWebSocket as any;

    try {
      const subscription = subscribeToDepositStatus("deposit_1", {
        onStatusUpdate: () => {},
      }, "sui-regtest");
      subscription.unsubscribe();
    } finally {
      global.WebSocket = originalWebSocket;
    }

    expect(sockets[0]).toBe("wss://api-hybrid.utxopia.com/ws/deposits/deposit_1");
  });
});
