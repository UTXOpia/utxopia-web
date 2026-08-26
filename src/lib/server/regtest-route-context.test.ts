import { describe, expect, it } from "bun:test";
import { resolveRegtestRouteConfig } from "./regtest-route-context";

describe("resolveRegtestRouteConfig", () => {
  it("accepts Solana hybrid regtest", () => {
    const result = resolveRegtestRouteConfig(
      new Request("https://app.utxopia.test/api/regtest/mine?network=devnet-regtest") as any,
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.network).toBe("devnet-regtest");
    expect(result.config.bitcoin.network).toBe("regtest");
  });

  it("refuses a network whose Bitcoin side is not regtest", () => {
    // devnet is a real deployment now, so this no longer falls back — and it
    // must not. Mining or funding on regtest when the caller asked for testnet4
    // would answer for a chain they did not name.
    const result = resolveRegtestRouteConfig(
      new Request("https://app.utxopia.test/api/regtest/mine?network=devnet") as any,
    );

    expect("error" in result).toBe(true);
    if (!("error" in result)) return;
    expect(result.status).toBe(400);
    expect(result.error).toContain("testnet4");
  });
});
