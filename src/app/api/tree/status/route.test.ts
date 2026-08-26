import { describe, expect, it, mock } from "bun:test";

const { GET } = await import("./route");

describe("/api/tree/status", () => {
  it("proxies Solana network status to the selected backend", async () => {
    const originalFetch = global.fetch;
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api-regtest.utxopia.com/api/tree/status?network=devnet-regtest");
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
