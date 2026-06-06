import { afterEach, describe, expect, it } from "bun:test";
import { detectNetwork, detectNetworkFromRequest, hrefWithChain, NETWORK_META } from "./network-config";

describe("network-config query routing", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("accepts chain=solana as a Solana alias instead of falling back to a Sui cookie", () => {
    const req = new Request("https://app.utxopia.test/vault/deposit?chain=solana", {
      headers: {
        cookie: "utxopia.network=sui-regtest",
      },
    });

    expect(detectNetworkFromRequest(req)).toBe("devnet");
  });

  it("routes chain=sui to the wired Sui hybrid network by default", () => {
    const req = new Request("https://app.utxopia.test/vault/deposit?chain=sui");

    expect(detectNetworkFromRequest(req)).toBe("sui-regtest");
  });

  it("routes generic env network=sui to the wired Sui default", () => {
    process.env.NEXT_PUBLIC_NETWORK = "sui";
    delete process.env.UTXOPIA_NETWORK;

    expect(detectNetwork()).toBe("sui-regtest");
  });

  it("does not expose incomplete Sui testnet as an enabled selector option", () => {
    const enabled = NETWORK_META.filter((item) => item.enabled).map((item) => item.id);

    expect(enabled).toContain("sui-regtest");
    expect(enabled).not.toContain("sui-testnet");
  });

  it("keeps exact network links canonical", () => {
    expect(hrefWithChain("/vault/deposit", "devnet-regtest")).toBe(
      "/vault/deposit?chain=sol&network=devnet-regtest",
    );
    expect(hrefWithChain("/vault/deposit", "sui-regtest")).toBe(
      "/vault/deposit?chain=sui&network=sui-regtest",
    );
  });
});
