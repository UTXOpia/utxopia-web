import { describe, expect, it } from "bun:test";
import { resolveAutoRelay } from "./relay-health";
import type { RelayConfig } from "./relays";
import type { RelayHealth } from "./relay-health";

function makeRelay(id: string): RelayConfig {
  return { id, name: id, url: (n) => `/api/sui/relay?network=${n}` };
}

function makeHealth(
  status: RelayHealth["status"],
  latencyMs: number | null = null,
): RelayHealth {
  return { status, latencyMs, checkedAt: Date.now() };
}

// Deterministic RNG seeded by a simple counter for tests
function seededRng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

describe("resolveAutoRelay", () => {
  it("returns null when all relays are offline", () => {
    const relays = [makeRelay("a"), makeRelay("b")];
    const health: Record<string, RelayHealth> = {
      a: makeHealth("offline"),
      b: makeHealth("offline"),
    };
    expect(resolveAutoRelay(relays, health)).toBeNull();
  });

  it("returns null when health map is empty", () => {
    const relays = [makeRelay("a")];
    expect(resolveAutoRelay(relays, {})).toBeNull();
  });

  it("returns the single online relay", () => {
    const relays = [makeRelay("a"), makeRelay("b")];
    const health: Record<string, RelayHealth> = {
      a: makeHealth("offline"),
      b: makeHealth("online", 120),
    };
    expect(resolveAutoRelay(relays, health)?.id).toBe("b");
  });

  it("prefers online over slow", () => {
    const relays = [makeRelay("slow"), makeRelay("fast")];
    const health: Record<string, RelayHealth> = {
      slow: makeHealth("slow", 50),   // lower latency but slow status
      fast: makeHealth("online", 200),
    };
    expect(resolveAutoRelay(relays, health)?.id).toBe("fast");
  });

  it("falls back to a slow relay when no online relays exist", () => {
    const relays = [makeRelay("a")];
    const health: Record<string, RelayHealth> = {
      a: makeHealth("slow", 900),
    };
    expect(resolveAutoRelay(relays, health)?.id).toBe("a");
  });

  it("prefers lower latency among multiple online relays", () => {
    const relays = [makeRelay("high"), makeRelay("low"), makeRelay("mid")];
    const health: Record<string, RelayHealth> = {
      high: makeHealth("online", 500),
      low: makeHealth("online", 80),
      mid: makeHealth("online", 250),
    };
    expect(resolveAutoRelay(relays, health)?.id).toBe("low");
  });

  it("returns a stable result given a seeded RNG when latencies are equal", () => {
    const relays = [makeRelay("x"), makeRelay("y"), makeRelay("z")];
    const health: Record<string, RelayHealth> = {
      x: makeHealth("online", 100),
      y: makeHealth("online", 100),
      z: makeHealth("online", 100),
    };
    const rng = seededRng(42);
    const result1 = resolveAutoRelay(relays, health, rng);
    const rng2 = seededRng(42);
    const result2 = resolveAutoRelay(relays, health, rng2);
    expect(result1?.id).toBe(result2?.id);
    // And it must be one of the candidates
    expect(["x", "y", "z"]).toContain(result1?.id);
  });
});
