"use client";

import { useEffect, useState } from "react";

/**
 * Ticking elapsed-seconds counter, active while `active` is true and reset to 0
 * when it goes false. Used to show liveness during long local work (proof
 * generation) so the user knows a slow operation is still progressing.
 */
export function useElapsedSeconds(active: boolean): number {
  const [seconds, setSeconds] = useState(0);

  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    setSeconds(0);
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);

  return seconds;
}
