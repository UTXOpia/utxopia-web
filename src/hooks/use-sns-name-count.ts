"use client";

import { useEffect, useState } from "react";

/**
 * Total number of .sol private names registered under the pool's parent domain.
 * Backed by the cached /api/sns/stats route. Returns null until loaded (or on
 * error) so callers can simply skip rendering when there's no number to show.
 */
export function useSnsRegisteredCount(networkId: string, enabled: boolean): number | null {
  const [count, setCount] = useState<number | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;
    fetch(`/api/sns/stats?network=${encodeURIComponent(networkId)}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!cancelled && data?.success && typeof data.count === "number") {
          setCount(data.count);
        }
      })
      .catch(() => {
        // Non-critical: the count is decorative, so a failed fetch just leaves it hidden.
      });
    return () => {
      cancelled = true;
    };
  }, [networkId, enabled]);

  return count;
}
