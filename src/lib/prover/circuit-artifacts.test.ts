import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  getJoinSplitArtifactUrls,
  preloadJoinSplitArtifacts,
} from "./circuit-artifacts";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("JoinSplit circuit artifacts", () => {
  it("builds the exact CDN paths used by the SDK", () => {
    expect(getJoinSplitArtifactUrls("https://cdn.example/circuits", 1, 3)).toEqual([
      "https://cdn.example/circuits/joinsplit_1x3/joinsplit_1x3_js/joinsplit_1x3.wasm",
      "https://cdn.example/circuits/joinsplit_1x3/joinsplit_1x3.zkey",
    ]);
  });

  it("downloads and fully consumes both artifacts", async () => {
    const arrayBuffer = mock(async () => new ArrayBuffer(1));
    const fetchMock = mock(async () => ({
      ok: true,
      arrayBuffer,
    }) as unknown as Response);
    globalThis.fetch = fetchMock as typeof fetch;

    await preloadJoinSplitArtifacts("https://cdn.example/circuits", 2, 2);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(arrayBuffer).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.cache === "force-cache")).toBe(true);
  });

  it("rejects invalid dimensions before fetching", async () => {
    const fetchMock = mock(async () => new Response());
    globalThis.fetch = fetchMock as typeof fetch;

    expect(preloadJoinSplitArtifacts("https://cdn.example/circuits", 8, 7))
      .rejects.toThrow("Invalid JoinSplit dimensions");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
