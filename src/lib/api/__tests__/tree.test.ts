import { afterEach, describe, expect, it, mock } from "bun:test";
import { getTreeStatus } from "../tree";

describe("tree API helpers", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("uses the explicit network backend for tree status", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api-hybrid.utxopia.com/api/tree/status");
      return Response.json({
        root: "abc",
        next_index: 2,
        size: 2,
        synced: true,
      });
    });
    global.fetch = fetchMock as any;

    await expect(getTreeStatus("devnet-regtest")).resolves.toEqual({
      root: "abc",
      next_index: 2,
      size: 2,
      synced: true,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
