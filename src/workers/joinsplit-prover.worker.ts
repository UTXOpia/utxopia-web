import type { JoinSplitProofInputs, ProofData } from "@utxopia/sdk";

type WorkerRequest =
  | { id: number; type: "init"; circuitPath?: string }
  | { id: number; type: "generate"; inputs: JoinSplitProofInputs; circuitPath?: string };

type WorkerResponse =
  | { id: number; ok: true; type: "init" }
  | { id: number; ok: true; type: "generate"; proof: ProofData; proofBytes: Uint8Array }
  | { id: number; ok: false; error: string };

type ProverModule = typeof import("@utxopia/sdk/prover/web");

let proverModulePromise: Promise<ProverModule> | null = null;
let initialized = false;

async function loadProver(circuitPath?: string): Promise<ProverModule> {
  const g = globalThis as typeof globalThis & {
    window?: unknown;
    snarkjs?: unknown;
  };

  // The SDK prover checks `typeof window` during import. Web Workers do not
  // expose `window`, but they are still a browser runtime and must fetch
  // artifacts from `/circuits/...`, not try Node filesystem paths.
  g.window ??= globalThis as unknown as Window & typeof globalThis;

  if (!g.snarkjs) {
    g.snarkjs = await import("snarkjs");
  }

  proverModulePromise ??= import("@utxopia/sdk/prover/web");
  const mod = await proverModulePromise;
  mod.setCircuitPath(circuitPath || "/circuits/groth16");
  return mod;
}

self.onmessage = async (event: MessageEvent<WorkerRequest>) => {
  const { id, type, circuitPath } = event.data;
  try {
    const mod = await loadProver(circuitPath);

    if (type === "init") {
      if (!initialized) {
        await mod.initProver();
        initialized = true;
      }
      self.postMessage({ id, ok: true, type: "init" } satisfies WorkerResponse);
      return;
    }

    const proof = await mod.generateJoinSplitProof(event.data.inputs);
    const proofBytes = mod.proofToBytes(proof);
    self.postMessage({
      id,
      ok: true,
      type: "generate",
      proof,
      proofBytes,
    } satisfies WorkerResponse);
  } catch (err) {
    self.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    } satisfies WorkerResponse);
  }
};
