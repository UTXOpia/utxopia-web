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

  it("resolves a Sui-primary network that also configures SNS (backend serves both)", () => {
    // The backend serves .sol on any network carrying an sns block; sui-regtest
    // does, so the route resolves. (The UI stays network-scoped and only shows
    // the current chain's names — that gating lives in the components.)
    const result = resolveSolanaRouteConfig(
      new Request("https://app.utxopia.test/api/sns/register?network=sui-regtest") as any,
      "/api/sns/register",
    );

    expect("error" in result).toBe(false);
    if ("error" in result) return;
    expect(result.config.sns?.parentDomain).toBe("utxopia");
    expect(result.config.solana.rpcUrl).not.toBe("");
  });
});
