/**
 * Prover Hook (Groth16 JoinSplit)
 *
 * Wraps SDK's JoinSplit proof generation with React state management.
 * All private transfers (claim, split, send) use unified JoinSplit(N,M) proofs.
 */

"use client";

import { useState, useCallback } from "react";
import type { JoinSplitProofInputs, ProofData } from "@utxopia/sdk";
import {
  initProver,
  generateJoinSplitProof,
  proofToBytes,
  setCircuitPath,
} from "@utxopia/sdk/prover/web";

// Point circuit artifacts at R2 CDN when configured
const cdnUrl = process.env.NEXT_PUBLIC_CIRCUIT_CDN_URL;
if (cdnUrl) {
  setCircuitPath(`${cdnUrl}/circuits/groth16`);
}

/**
 * Load snarkjs's official browser build (build/browser.esm.js, resolved by
 * webpack via the package's `browser` export condition) and hand it to the
 * SDK prover through globalThis. The SDK can't do this import itself: its
 * Node-oriented dynamic import is deliberately opaque to bundlers.
 */
async function ensureBrowserSnarkjs(): Promise<void> {
  const g = globalThis as Record<string, unknown>;
  if (g.snarkjs) return;
  g.snarkjs = await import("snarkjs");
}

interface ProverState {
  isInitialized: boolean;
  isGenerating: boolean;
  progress: string | null;
  error: string | null;
  initialize: () => Promise<void>;
  generateProof: (inputs: JoinSplitProofInputs) => Promise<{
    proof: ProofData;
    proofBytes: Uint8Array;
  }>;
}

export function useProver(): ProverState {
  const [isInitialized, setIsInitialized] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const initialize = useCallback(async () => {
    try {
      setProgress("Preparing privacy engine...");
      await ensureBrowserSnarkjs();
      await initProver();
      setIsInitialized(true);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize prover");
      setProgress(null);
    }
  }, []);

  const generateProof = useCallback(
    async (inputs: JoinSplitProofInputs) => {
      setIsGenerating(true);
      setError(null);
      setProgress("Generating privacy proof...");
      try {
        await ensureBrowserSnarkjs();
        const proof = await generateJoinSplitProof(inputs);
        const bytes = proofToBytes(proof);
        setProgress(null);
        return { proof, proofBytes: bytes };
      } catch (err) {
        const msg =
          err instanceof Error ? err.message : "Proof generation failed";
        setError(msg);
        throw err;
      } finally {
        setIsGenerating(false);
        setProgress(null);
      }
    },
    []
  );

  return {
    isInitialized,
    isGenerating,
    progress,
    error,
    initialize,
    generateProof,
  };
}
