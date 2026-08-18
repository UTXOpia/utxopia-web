import manifest from "./circuit-manifest.json";

export function getJoinSplitArtifactUrls(
  circuitPath: string,
  nInputs: number,
  nOutputs: number,
): [wasmUrl: string, zkeyUrl: string] {
  if (
    !Number.isInteger(nInputs) ||
    !Number.isInteger(nOutputs) ||
    nInputs < 1 ||
    nOutputs < 1 ||
    nInputs + nOutputs > 10
  ) {
    throw new Error(
      `Invalid JoinSplit dimensions: ${nInputs}x${nOutputs} (N+M must be 2..10)`,
    );
  }

  const name = `joinsplit_${nInputs}x${nOutputs}`;
  return [
    `${circuitPath}/${name}/${name}_js/${name}.wasm`,
    `${circuitPath}/${name}/${name}.zkey`,
  ];
}

/** Manifest keys are circuit-root-relative, so strip whatever base the URL was built from. */
function manifestKey(nInputs: number, nOutputs: number): [string, string] {
  const name = `joinsplit_${nInputs}x${nOutputs}`;
  return [`${name}/${name}_js/${name}.wasm`, `${name}/${name}.zkey`];
}

const expectedDigests = manifest.artifacts as Record<string, string>;

const toHex = (buf: ArrayBuffer) =>
  Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, "0")).join("");

/** URLs whose bytes already matched this session — hashing 6 MB twice per proof is wasteful. */
const verified = new Set<string>();

/**
 * Download a circuit artifact and refuse it unless its bytes match the committed digest.
 *
 * The `.wasm` here is the witness generator: it is handed the spending key, the nullifying key,
 * note randomness, amounts and the full Merkle path in the clear. It arrives over plain `fetch`
 * from a CDN, where `integrity=` does not apply, and is served `immutable, max-age=31536000` —
 * so a substituted file keeps working out of browser and edge caches long after the origin is
 * cleaned up, and the proofs it produces still verify. Comparing against a digest that shipped
 * inside the bundle is the only check the delivery path cannot also serve.
 */
/**
 * Match already-downloaded bytes against the digest committed for `key`, or throw.
 *
 * Split out so callers that fetch an artifact themselves — `/verify-proof` pulls a bare
 * `.vkey.json` — get the same check without going through the JoinSplit preload path.
 */
export async function assertArtifactDigest(key: string, bytes: ArrayBuffer): Promise<void> {
  const expected = expectedDigests[key];
  if (!expected) {
    throw new Error(
      `No integrity digest for circuit artifact ${key} — regenerate scripts/gen-circuit-manifest.ts`,
    );
  }
  const actual = toHex(await crypto.subtle.digest("SHA-256", bytes));
  if (actual !== expected) {
    throw new Error(
      `Circuit artifact ${key} failed integrity check (expected ${expected}, got ${actual}).`,
    );
  }
}

async function fetchVerifiedArtifact(url: string, key: string): Promise<ArrayBuffer> {
  const expected = expectedDigests[key];
  if (!expected) {
    // Fails closed on purpose. If this fires in production it means the manifest was built from
    // a narrower source than the origin actually serves — regenerate it against that origin
    // (`bun run gen-circuit-manifest --url <origin>`), do not relax the check.
    throw new Error(
      `No integrity digest for circuit artifact ${key} — regenerate scripts/gen-circuit-manifest.ts`,
    );
  }

  const response = await fetch(url, { cache: "force-cache" });
  if (!response.ok) {
    throw new Error(`Failed to preload circuit artifact ${url}: HTTP ${response.status}`);
  }
  const bytes = await response.arrayBuffer();

  const actual = toHex(await crypto.subtle.digest("SHA-256", bytes));
  if (actual !== expected) {
    verified.delete(url);
    throw new Error(
      `Circuit artifact ${key} failed integrity check (expected ${expected}, got ${actual}). ` +
        `Refusing to prove — the served artifact does not match this build.`,
    );
  }
  verified.add(url);
  return bytes;
}

/**
 * Fully consume both responses so the browser HTTP cache has complete circuit
 * artifacts ready when snarkjs requests them after confirmation, and verify each
 * against its committed SHA-256 before any of it reaches the prover.
 */
export async function preloadJoinSplitArtifacts(
  circuitPath: string,
  nInputs: number,
  nOutputs: number,
): Promise<void> {
  const urls = getJoinSplitArtifactUrls(circuitPath, nInputs, nOutputs);
  const keys = manifestKey(nInputs, nOutputs);
  await Promise.all(
    urls.map(async (url, i) => {
      if (verified.has(url)) return;
      await fetchVerifiedArtifact(url, keys[i]);
    }),
  );
}

/**
 * Throw unless both artifacts for this shape have been fetched and verified in this session.
 *
 * Preloading is a separate call from proving, so this is the guard on the proving path itself —
 * without it, a caller that skips preload hands unverified bytes straight to snarkjs.
 */
export async function assertJoinSplitArtifactsVerified(
  circuitPath: string,
  nInputs: number,
  nOutputs: number,
): Promise<void> {
  await preloadJoinSplitArtifacts(circuitPath, nInputs, nOutputs);
}
