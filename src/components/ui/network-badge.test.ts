import { describe, expect, it } from "bun:test";
import { getNetworkBadgePresentation } from "./network-badge";

describe("NetworkBadge presentation", () => {
  it("surfaces Solana devnet as an explicit active network", () => {
    expect(getNetworkBadgePresentation("devnet")).toMatchObject({
      chain: "sol",
      label: "Solana Devnet",
    });
  });

  it("surfaces Solana hybrid without hiding the chain context", () => {
    expect(getNetworkBadgePresentation("devnet-regtest")).toMatchObject({
      chain: "sol",
      label: "Solana Hybrid",
    });
  });

  it("does not duplicate the Sui chain name when the network label already includes it", () => {
    expect(getNetworkBadgePresentation("sui-regtest")).toMatchObject({
      chain: "sui",
      label: "Sui Hybrid",
    });
  });
});
