import { describe, expect, it } from "bun:test";
import { resolveSolanaRouteConfig } from "./solana-route-context";
import { getNetworkConfig } from "@/lib/network-config";

describe("resolveSolanaRouteConfig", () => {
  it("resolves the selected Solana network config", () => {
    const result = resolveSolanaRouteConfig(
      new Request("https://app.utxopia.test/api/sns/register?network=devnet-regtest") as any,
      "/api/sns/register",
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.config.solana.rpcUrl).toBe(
      getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }).solana.rpcUrl,
    );
    expect(result.config.bitcoin.network).toBe("regtest");
  });

  it("rejects Sui network requests", () => {
    expect(resolveSolanaRouteConfig(
      new Request("https://app.utxopia.test/api/sns/register?network=sui-regtest") as any,
      "/api/sns/register",
    )).toEqual({
      error: "/api/sns/register is only available on Solana networks.",
      status: 400,
    });
  });
});
