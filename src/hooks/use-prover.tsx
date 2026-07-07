/**
 * Prover Hook (Groth16 JoinSplit)
 *
 * Wraps SDK's JoinSplit proof generation with React state management.
 * All private transfers (claim, split, send) use unified JoinSplit(N,M) proofs.
 */

"use client";

import { useRef, useState, useCallback } from "react";
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

const circuitPath = cdnUrl ? `${cdnUrl}/circuits/groth16` : "/circuits/groth16";
const PROVER_WORKER_TIMEOUT_MS = 120_000;
const useProverWorker =
  typeof window !== "undefined" &&
  typeof Worker !== "undefined" &&
  process.env.NEXT_PUBLIC_DISABLE_PROVER_WORKER !== "1";

type WorkerResponse =
  | { id: number; ok: true; type: "init" }
  | { id: number; ok: true; type: "generate"; proof: ProofData; proofBytes: Uint8Array }
  | { id: number; ok: false; error: string };

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
  const workerRef = useRef<Worker | null>(null);
  const requestIdRef = useRef(0);

  const resetWorker = useCallback(() => {
    workerRef.current?.terminate();
    workerRef.current = null;
    setIsInitialized(false);
  }, []);

  const getWorker = useCallback(() => {
    workerRef.current ??= new Worker(
      new URL("../workers/joinsplit-prover.worker.ts", import.meta.url),
      { type: "module" },
    );
    return workerRef.current;
  }, []);

  const callWorker = useCallback(
    <T,>(message: Record<string, unknown>): Promise<T> => {
      const worker = getWorker();
      const id = ++requestIdRef.current;

      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          resetWorker();
          reject(new Error("Proof generation timed out. This can happen on slower devices or with large transfers — please try again."));
        }, PROVER_WORKER_TIMEOUT_MS);

        worker.onmessage = (event: MessageEvent<WorkerResponse>) => {
          if (event.data.id !== id) return;
          clearTimeout(timer);
          if (!event.data.ok) {
            reject(new Error(event.data.error));
            return;
          }
          resolve(event.data as T);
        };

        worker.onerror = (event) => {
          clearTimeout(timer);
          resetWorker();
          reject(new Error(event.message || "Prover worker failed"));
        };

        worker.postMessage({ id, circuitPath, ...message });
      });
    },
    [getWorker, resetWorker],
  );

  const initialize = useCallback(async () => {
    try {
      setProgress("Preparing privacy engine...");
      if (useProverWorker) {
        await callWorker<{ id: number; ok: true; type: "init" }>({ type: "init" });
        setIsInitialized(true);
        setProgress(null);
        return;
      }
      await ensureBrowserSnarkjs();
      await initProver();
      setIsInitialized(true);
      setProgress(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to initialize prover");
      setProgress(null);
    }
  }, [callWorker]);

  const generateProof = useCallback(
    async (inputs: JoinSplitProofInputs) => {
      setIsGenerating(true);
      setError(null);
      setProgress("Generating privacy proof...");
      try {
        if (useProverWorker) {
          const result = await callWorker<{
            id: number;
            ok: true;
            type: "generate";
            proof: ProofData;
            proofBytes: Uint8Array;
          }>({ type: "generate", inputs });
          setProgress(null);
          return { proof: result.proof, proofBytes: result.proofBytes };
        }
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
    [callWorker]
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
