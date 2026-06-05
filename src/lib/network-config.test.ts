import { describe, expect, it } from "bun:test";
import { detectNetworkFromRequest, hrefWithChain } from "./network-config";

describe("network-config query routing", () => {
  it("accepts chain=solana as a Solana alias instead of falling back to a Sui cookie", () => {
    const req = new Request("https://app.utxopia.test/vault/deposit?chain=solana", {
      headers: {
        cookie: "utxopia.network=sui-regtest",
      },
    });

    expect(detectNetworkFromRequest(req)).toBe("devnet");
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
