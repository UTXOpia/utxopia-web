import { afterEach, describe, expect, it, mock } from "bun:test";
import {
  getJoinSplitArtifactUrls,
  preloadJoinSplitArtifacts,
} from "./circuit-artifacts";
import manifest from "./circuit-manifest.json";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
});

/** Bytes whose SHA-256 is the digest the manifest records for this artifact. */
async function serveMatching(key: string) {
  const expected = (manifest.artifacts as Record<string, string>)[key];
  // Search a tiny space for a payload hashing to the recorded digest is impossible, so instead
  // serve real bytes and assert the manifest was built from them: read the file the manifest
  // was generated from.
  const bytes = new Uint8Array(
    await Bun.file(`${import.meta.dir}/../../../public/circuits/groth16/${key}`).arrayBuffer(),
  );
  const actual = Array.from(
    new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
    (b) => b.toString(16).padStart(2, "0"),
  ).join("");
  return { bytes, expected, actual };
}

describe("JoinSplit circuit artifacts", () => {
  it("builds the exact CDN paths used by the SDK", () => {
    expect(getJoinSplitArtifactUrls("https://cdn.example/circuits", 1, 3)).toEqual([
      "https://cdn.example/circuits/joinsplit_1x3/joinsplit_1x3_js/joinsplit_1x3.wasm",
      "https://cdn.example/circuits/joinsplit_1x3/joinsplit_1x3.zkey",
    ]);
  });

  it("downloads and fully consumes both artifacts when the digests match", async () => {
    const wasm = await serveMatching("joinsplit_2x2/joinsplit_2x2_js/joinsplit_2x2.wasm");
    const zkey = await serveMatching("joinsplit_2x2/joinsplit_2x2.zkey");
    // The manifest must describe what is actually on disk, or every browser refuses to prove.
    expect(wasm.actual).toBe(wasm.expected);
    expect(zkey.actual).toBe(zkey.expected);

    const fetchMock = mock(async (url: string) => ({
      ok: true,
      arrayBuffer: async () => (url.endsWith(".wasm") ? wasm.bytes : zkey.bytes).buffer,
    }) as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await preloadJoinSplitArtifacts("https://cdn.example/circuits", 2, 2);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls.every(([, init]) => init?.cache === "force-cache")).toBe(true);
  });

  it("refuses a substituted artifact", async () => {
    // A poisoned .wasm is the witness generator, and it receives the spending key in the clear.
    const fetchMock = mock(async () => ({
      ok: true,
      arrayBuffer: async () => new TextEncoder().encode("not the real circuit").buffer,
    }) as unknown as Response);
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(
      preloadJoinSplitArtifacts("https://cdn.example/circuits", 3, 1),
    ).rejects.toThrow("failed integrity check");
  });

  it("refuses a shape that has no recorded digest", async () => {
    // Fail closed rather than prove against something unverifiable. Pick whichever on-chain-valid
    // shape the shipped manifest happens not to cover, so this keeps testing the behaviour after
    // the manifest is regenerated against a fuller origin.
    const recorded = manifest.artifacts as Record<string, string>;
    let uncovered: [number, number] | null = null;
    for (let n = 1; n <= 9 && !uncovered; n++) {
      for (let m = 1; n + m <= 10; m++) {
        if (!recorded[`joinsplit_${n}x${m}/joinsplit_${n}x${m}.zkey`]) {
          uncovered = [n, m];
          break;
        }
      }
    }
    if (!uncovered) return; // manifest covers every shape — nothing to fail closed on

    const fetchMock = mock(async () => new Response());
    globalThis.fetch = fetchMock as typeof fetch;

    await expect(
      preloadJoinSplitArtifacts("https://cdn.example/circuits", ...uncovered),
    ).rejects.toThrow("No integrity digest");
  });

  it("rejects invalid dimensions before fetching", async () => {
    const fetchMock = mock(async () => new Response());
    globalThis.fetch = fetchMock as typeof fetch;

    expect(preloadJoinSplitArtifacts("https://cdn.example/circuits", 8, 7))
      .rejects.toThrow("Invalid JoinSplit dimensions");
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
