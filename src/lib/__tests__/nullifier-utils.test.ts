import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fetchSpentNullifierPDAs } from "../nullifier-utils";

const mockFetch = mock(() => Promise.resolve({} as Response));
global.fetch = mockFetch as any;

describe("fetchSpentNullifierPDAs", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("routes proxy requests by network and caches each network independently", async () => {
    mockFetch
      .mockResolvedValueOnce({
        json: async () => ({ pdas: ["pda-sol"], latest_slot: 10, total: 1 }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ pdas: ["pda-sui"], latest_slot: 20, total: 1 }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ pdas: [], latest_slot: 10, total: 1 }),
      } as any);

    const sol = await fetchSpentNullifierPDAs("", "devnet-regtest");
    const sui = await fetchSpentNullifierPDAs("", "sui-regtest");
    const solAgain = await fetchSpentNullifierPDAs("", "devnet-regtest");

    expect(sol.has("pda-sol")).toBe(true);
    expect(sol.has("pda-sui")).toBe(false);
    expect(sui.has("pda-sui")).toBe(true);
    expect(sui.has("pda-sol")).toBe(false);
    expect(solAgain.has("pda-sol")).toBe(true);
    expect(solAgain.has("pda-sui")).toBe(false);

    expect(mockFetch.mock.calls[0][0]).toBe("/api/nullifiers?network=devnet-regtest");
    expect(mockFetch.mock.calls[1][0]).toBe("/api/nullifiers?network=sui-regtest");
    expect(mockFetch.mock.calls[2][0]).toBe("/api/nullifiers?since=10&network=devnet-regtest");
  });
});
