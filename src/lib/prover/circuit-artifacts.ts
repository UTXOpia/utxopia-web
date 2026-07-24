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
    nInputs + nOutputs > 14
  ) {
    throw new Error(
      `Invalid JoinSplit dimensions: ${nInputs}x${nOutputs} (N+M must be 2..14)`,
    );
  }

  const name = `joinsplit_${nInputs}x${nOutputs}`;
  return [
    `${circuitPath}/${name}/${name}_js/${name}.wasm`,
    `${circuitPath}/${name}/${name}.zkey`,
  ];
}

/**
 * Fully consume both responses so the browser HTTP cache has complete circuit
 * artifacts ready when snarkjs requests them after confirmation.
 */
export async function preloadJoinSplitArtifacts(
  circuitPath: string,
  nInputs: number,
  nOutputs: number,
): Promise<void> {
  const urls = getJoinSplitArtifactUrls(circuitPath, nInputs, nOutputs);
  await Promise.all(urls.map(async (url) => {
    const response = await fetch(url, { cache: "force-cache" });
    if (!response.ok) {
      throw new Error(`Failed to preload circuit artifact ${url}: HTTP ${response.status}`);
    }
    await response.arrayBuffer();
  }));
}
