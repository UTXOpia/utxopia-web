/**
 * Reject a promise if it doesn't settle within `ms`, with a caller-supplied
 * message. The underlying work isn't cancelled — the timeout just frees the
 * caller (and UI) to surface an error instead of hanging indefinitely.
 */
export function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

/**
 * Upper bound on ZK proof generation. Proof generation is pure local compute
 * with no on-chain effect, so a timeout + retry is always safe (no double-submit
 * risk). Generous enough to avoid false timeouts on slow mobile devices while
 * still escaping a hung WASM prover.
 */
export const PROOF_TIMEOUT_MS = 120_000;
