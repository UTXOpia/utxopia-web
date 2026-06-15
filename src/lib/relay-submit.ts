/**
 * submitWithFailover — try relay candidates in order, skipping retriable failures.
 *
 * "Retriable" = network/transport error (fetch threw, 5xx, timeout/abort).
 * "Non-retriable" = validation/proof rejection — should fail fast.
 *
 * Note: submitToRelay in the SDK returns { success, error? } on HTTP 4xx/5xx
 * (resp.json() always resolves). It only THROWS on network-level errors (fetch
 * rejects with TypeError). So this wrapper catches thrown errors only; callers
 * still need to check result.success themselves.
 */

export interface FailoverOpts {
  onFailover?: (failedUrl: string, nextUrl: string, err: unknown) => void;
  isRetriable?: (err: unknown) => boolean;
}

/**
 * Returns true for errors that indicate a relay is unreachable/broken at the
 * transport layer — safe to retry against a different relay. Returns false for
 * validation/proof rejections that would fail on any relay.
 */
export function defaultIsRetriable(err: unknown): boolean {
  if (err instanceof TypeError) {
    // fetch() network failures: "Failed to fetch", "fetch failed", "NetworkError", etc.
    return true;
  }
  if (err instanceof DOMException && err.name === "AbortError") {
    // AbortController timeout
    return true;
  }
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    // Timeout strings from withTimeout or relay wrappers
    if (msg.includes("timeout") || msg.includes("timed out")) return true;
    // Node.js fetch network errors
    if (msg.includes("econnrefused") || msg.includes("econnreset")) return true;
    if (msg.includes("network") && msg.includes("error")) return true;
    if (msg.includes("fetch failed")) return true;
    // HTTP 5xx surfaced as thrown error (some relay wrappers do this)
    if (/\b5\d\d\b/.test(msg)) return true;
  }
  return false;
}

/**
 * Try `submit` with each candidate URL in order. On a retriable error, advance
 * to the next candidate (calling onFailover). On a non-retriable error, throws
 * immediately. If all candidates fail, throws the last error.
 */
export async function submitWithFailover<T>(
  submit: (relayUrl: string) => Promise<T>,
  candidates: string[],
  opts?: FailoverOpts,
): Promise<T> {
  if (candidates.length === 0) {
    throw new Error("No relay candidates available");
  }

  const isRetriable = opts?.isRetriable ?? defaultIsRetriable;
  let lastErr: unknown;

  for (let i = 0; i < candidates.length; i++) {
    try {
      return await submit(candidates[i]);
    } catch (err) {
      if (!isRetriable(err)) {
        throw err;
      }
      lastErr = err;
      const nextUrl = candidates[i + 1];
      if (nextUrl !== undefined) {
        opts?.onFailover?.(candidates[i], nextUrl, err);
      }
    }
  }

  throw lastErr;
}
