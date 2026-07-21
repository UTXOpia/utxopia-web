import { describe, expect, it } from "bun:test";
import { getNetworkBadgePresentation } from "./network-badge";

describe("NetworkBadge presentation", () => {
  it("surfaces Solana devnet as an explicit active network", () => {
    expect(getNetworkBadgePresentation("devnet")).toMatchObject({
      chain: "sol",
      label: "Devnet",
    });
  });

  it("surfaces Solana hybrid without hiding the chain context", () => {
    expect(getNetworkBadgePresentation("devnet-regtest")).toMatchObject({
      chain: "sol",
      label: "Hybrid",
    });
  });
});
