import { beforeEach, describe, expect, it, mock } from "bun:test";
import { fetchAnnouncements } from "../use-explorer";

const mockFetch = mock(() => Promise.resolve({} as Response));
global.fetch = mockFetch as any;

describe("fetchAnnouncements", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  it("passes explicit network routing to the announcements proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ success: true, announcements: [] }),
    } as any);

    await fetchAnnouncements("devnet-regtest");

    expect(mockFetch.mock.calls[0][0]).toBe("/api/announcements?network=devnet-regtest");
  });
});
