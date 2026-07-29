/**
 * Relay health checking and auto-selection.
 *
 * pingRelay uses /api/relayer/meta (a GET endpoint that exists in this app) as a
 * reachability probe. The relay submission route (/api/sol/relay)
 * only export POST, so a HEAD/GET to those returns 405 — not a useful health signal.
 * /api/relayer/meta is always present, returns JSON quickly, and shares the same
 * origin as the relay routes, making it a reliable liveness indicator.
 */

import type { RelayConfig } from "./relays";

export interface RelayHealth {
  status: "online" | "slow" | "offline";
  latencyMs: number | null;
  checkedAt: number;
}

const SLOW_THRESHOLD_MS = 800;
const DEFAULT_TIMEOUT_MS = 4000;

/**
 * Pings `relayBaseUrl` by fetching `/api/relayer/meta` (a GET route) to check
 * reachability. For relative URLs (same-origin, the common case) the base URL
 * is the relay's host — we just hit the well-known meta endpoint. For absolute
 * external relay URLs this pings `<externalHost>/api/relayer/meta`.
 */
export async function pingRelay(
  relayUrl: string,
  opts?: { timeoutMs?: number },
): Promise<RelayHealth> {
  const timeoutMs = opts?.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  // Derive the health probe URL from the relay URL.
  // Relay URLs look like `/api/sol/relay?network=...` (relative) or
  // `https://host/api/sol/relay?network=...` (absolute external).
  let probeUrl: string;
  try {
    if (relayUrl.startsWith("/") || relayUrl.startsWith("http")) {
      const base = relayUrl.startsWith("/")
        ? (typeof window !== "undefined" ? window.location.origin : "")
        : new URL(relayUrl).origin;
      probeUrl = `${base}/api/relayer/meta`;
    } else {
      probeUrl = "/api/relayer/meta";
    }
  } catch {
    probeUrl = "/api/relayer/meta";
  }

  const start = Date.now();
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch(probeUrl, {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
    clearTimeout(timer);

    const latencyMs = Date.now() - start;
    if (!response.ok) {
      return { status: "offline", latencyMs, checkedAt: Date.now() };
    }
    return {
      status: latencyMs > SLOW_THRESHOLD_MS ? "slow" : "online",
      latencyMs,
      checkedAt: Date.now(),
    };
  } catch {
    return { status: "offline", latencyMs: null, checkedAt: Date.now() };
  }
}

/**
 * Picks the best available relay from `relays` given known `health` records.
 *
 * Strategy:
 * 1. Filter to online relays; if none, try slow relays; if none, return null.
 * 2. Among candidates, prefer the one with the lowest latency.
 * 3. When multiple relays share the same (minimum) latency, pick pseudo-randomly
 *    to avoid fingerprinting the user by a deterministic preference.
 *
 * @param rng - Optional seeded random function (returns [0,1)). Accepts a seeded
 *   function for deterministic tests; defaults to Math.random in production.
 */
export function resolveAutoRelay(
  relays: RelayConfig[],
  health: Record<string, RelayHealth>,
  rng: () => number = Math.random,
): RelayConfig | null {
  const scoredCandidates = (statuses: Array<"online" | "slow">): RelayConfig | null => {
    const candidates = relays.filter((r) => {
      const h = health[r.id];
      return h && (statuses as string[]).includes(h.status);
    });
    if (candidates.length === 0) return null;

    // Sort by latency ascending (nulls last)
    candidates.sort((a, b) => {
      const la = health[a.id].latencyMs ?? Infinity;
      const lb = health[b.id].latencyMs ?? Infinity;
      return la - lb;
    });

    // Collect all candidates tied at the minimum latency
    const minLatency = health[candidates[0].id].latencyMs ?? Infinity;
    const tied = candidates.filter(
      (r) => (health[r.id].latencyMs ?? Infinity) === minLatency,
    );

    return tied[Math.floor(rng() * tied.length)];
  };

  return scoredCandidates(["online"]) ?? scoredCandidates(["slow"]);
}
