import { describe, expect, it } from "bun:test";
import { parseVaultScope, tagVault, vaultTargets } from "./vault-fanout";

describe("parseVaultScope", () => {
  it("accepts the two pool ids and defaults everything else to all", () => {
    expect(parseVaultScope("open")).toBe("open");
    expect(parseVaultScope("verified")).toBe("verified");
    expect(parseVaultScope("VERIFIED")).toBe("verified");
    expect(parseVaultScope(null)).toBe("all");
    expect(parseVaultScope("nonsense")).toBe("all");
  });
});

describe("vaultTargets", () => {
  it("fans out to both pools on a dual-vault network", () => {
    const targets = vaultTargets("devnet-regtest", "all");
    expect(targets.map((t) => t.vaultId)).toEqual(["open", "verified"]);
    expect(targets[0].backendUrl.endsWith("/open")).toBe(true);
    expect(targets[1].backendUrl.endsWith("/verified")).toBe(true);
  });

  it("returns a single pool when scoped", () => {
    const targets = vaultTargets("devnet-regtest", "verified");
    expect(targets).toHaveLength(1);
    expect(targets[0].vaultId).toBe("verified");
  });

  it("stays untagged and single-target where vaults are unsupported", () => {
    const targets = vaultTargets("mainnet" as never, "all");
    expect(targets).toHaveLength(1);
    expect(targets[0].vaultId).toBeNull();
    expect(targets[0].backendUrl.endsWith("/open")).toBe(false);
  });
});

describe("tagVault", () => {
  it("stamps rows with their pool", () => {
    expect(tagVault([{ id: 1 }, { id: 2 }], "verified")).toEqual([
      { id: 1, vault: "verified" },
      { id: 2, vault: "verified" },
    ]);
  });

  it("leaves rows untouched when there is no vault", () => {
    const rows = [{ id: 1 }];
    expect(tagVault(rows, null)).toBe(rows);
  });
});
