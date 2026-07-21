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

  it("falls back from unsupported testnet4 networks to Solana regtest", () => {
    const result = resolveRegtestRouteConfig(
      new Request("https://app.utxopia.test/api/regtest/mine?network=devnet") as any,
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.network).toBe("devnet-regtest");
    expect(result.config.bitcoin.network).toBe("regtest");
  });
});
