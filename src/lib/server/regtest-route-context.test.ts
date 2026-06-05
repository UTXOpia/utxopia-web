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

  it("accepts Sui hybrid regtest", () => {
    const result = resolveRegtestRouteConfig(
      new Request("https://app.utxopia.test/api/regtest/mine?network=sui-regtest") as any,
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.network).toBe("sui-regtest");
    expect(result.config.bitcoin.network).toBe("regtest");
  });

  it("rejects non-regtest networks", () => {
    expect(resolveRegtestRouteConfig(
      new Request("https://app.utxopia.test/api/regtest/mine?network=devnet") as any,
    )).toEqual({
      error: "regtest helper only available on regtest; current network=devnet, btcNetwork=testnet4",
      status: 400,
    });
  });
});
