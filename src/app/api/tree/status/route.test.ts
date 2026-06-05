import { beforeEach, describe, expect, it, mock } from "bun:test";

const fetchSuiExplorerStats = mock(async () => ({
  totalShielded: 1_000n,
  depositCount: 1,
  totalCommitments: 7,
  volume: 1_000n,
}));

mock.module("@/lib/sui/explorer", () => ({
  fetchSuiExplorerStats,
}));

const { GET } = await import("./route");

describe("/api/tree/status", () => {
  beforeEach(() => {
    fetchSuiExplorerStats.mockClear();
  });

  it("returns event-backed tree status for Sui networks", async () => {
    const response = await GET(new Request("https://app.utxopia.test/api/tree/status?network=sui-regtest") as any);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSuiExplorerStats).toHaveBeenCalledTimes(1);
    expect(json).toEqual({
      success: true,
      source: "sui-events",
      synced: true,
      root: null,
      next_index: 7,
      size: 7,
      announcements: 7,
      nullifiers: 0,
    });
  });

  it("proxies Solana network status to the selected backend", async () => {
    const originalFetch = global.fetch;
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api-hybrid.utxopia.com/api/tree/status?network=devnet-regtest");
      return Response.json({ synced: true, root: "abc", next_index: 1, size: 1 });
    });
    global.fetch = fetchMock as any;

    try {
      const response = await GET(new Request("https://app.utxopia.test/api/tree/status?network=devnet-regtest") as any);
      const json = await response.json();

      expect(response.status).toBe(200);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      expect(json).toEqual({ synced: true, root: "abc", next_index: 1, size: 1 });
    } finally {
      global.fetch = originalFetch;
    }
  });
});
