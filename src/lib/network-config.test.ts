import { afterEach, describe, expect, it } from "bun:test";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  hrefWithChain,
  NETWORK_META,
} from "./network-config";
import {
  getVaultNetworkConfig,
  getVaultPrivacyDomain,
  getVaultRuntimeConfig,
} from "./vault-config";

describe("network-config query routing", () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("accepts chain=solana as a Solana alias instead of falling back to a stale cookie", () => {
    const req = new Request("https://app.utxopia.test/vault/deposit?chain=solana", {
      headers: {
        cookie: "utxopia.network=deprecated-net",
      },
    });

    expect(detectNetworkFromRequest(req)).toBe("devnet-regtest");
  });

  it("exposes both deployed environments", () => {
    const enabled = NETWORK_META.filter((item) => item.enabled).map((item) => item.id);
    const devnet = NETWORK_META.find((item) => item.id === "devnet");

    expect(enabled).toContain("devnet-regtest");
    expect(enabled).toContain("devnet");
    expect(devnet?.comingSoon).toBeFalsy();
  });

  it("honours an explicit network in the query, and still falls back for one that is not deployed", () => {
    expect(detectNetworkFromRequest(new Request("https://app.utxopia.test/?chain=sol&network=devnet"))).toBe(
      "devnet",
    );
    expect(detectNetworkFromRequest(new Request("https://app.utxopia.test/?chain=sol&network=testnet"))).toBe(
      "devnet-regtest",
    );
  });

  it("enabled live networks have the backend and Bitcoin fields required by user flows", () => {
    for (const meta of NETWORK_META.filter((item) => item.enabled && !item.comingSoon)) {
      const cfg = getNetworkConfig(meta.id, { applyEnvOverrides: false });

      expect(cfg.backend.url, `${meta.id} backend.url`).toMatch(/^https?:\/\//);
      expect(cfg.bitcoin.network, `${meta.id} bitcoin.network`).toBeTruthy();
      expect(cfg.bitcoin.explorerUrl, `${meta.id} bitcoin.explorerUrl`).toMatch(/^https?:\/\//);

      expect(cfg.solana.utxopiaProgramId, `${meta.id} solana.utxopiaProgramId`).toBeTruthy();
      expect(cfg.tokens.zkbtcMint, `${meta.id} tokens.zkbtcMint`).toBeTruthy();
      expect(cfg.bitcoin.poolAddress, `${meta.id} bitcoin.poolAddress`).toBeTruthy();
      expect(cfg.sns?.nameServiceProgramId, `${meta.id} sns.nameServiceProgramId`).toBeTruthy();
      expect(cfg.sns?.subRegistrarProgramId, `${meta.id} sns.subRegistrarProgramId`).toBeTruthy();
      expect(cfg.sns?.parentDomain, `${meta.id} sns.parentDomain`).toBe("utxopia");
    }
  });

  it("keeps both vault identities available without a global deployment switch", () => {
    const base = getNetworkConfig("devnet-regtest", { applyEnvOverrides: false });
    const open = getVaultNetworkConfig("devnet-regtest", base, "open");
    const verified = getVaultNetworkConfig("devnet-regtest", base, "verified");

    expect(open.solana.permissioned).toBe(false);
    expect(open.solana.poolState).toBe(
      "CeEEmE9MvFPZtqcgv1rsXmzNmfvchbs8VEZJGFKZ2Cyj",
    );
    expect(verified.solana.permissioned).toBe(true);
    expect(verified.solana.poolState).toBe(
      "7u3eYJ2Gksb8JoLC7bpyJvjh8UVgVqVEwzWbrDCLSkh9",
    );
    expect(open.tokens.zkbtcMint).not.toBe(verified.tokens.zkbtcMint);
    // Each vault has its own Ika dWallet, so its own taproot address. Sharing one
    // would mean one indistinguishable UTXO set across both vaults.
    expect(open.bitcoin.poolAddress).not.toBe(verified.bitcoin.poolAddress);
    expect(open.ika?.dwallet).not.toBe(verified.ika?.dwallet);
    expect(open.backend.url).toBe("https://api-regtest.utxopia.com/open");
    expect(verified.backend.url).toBe("https://api-regtest.utxopia.com/verified");
    expect(getVaultRuntimeConfig("devnet-regtest", "verified").policyMode).toBe("per");
    expect(getVaultPrivacyDomain("open")).toBe("public");
    expect(getVaultPrivacyDomain("verified")).toBe("institution");
  });

  it("keeps SNS deployment config request-scoped by network", () => {
    expect(getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }).sns?.rootDomain).toBe(
      "5eoDkP6vCQBXqDV9YN2NdUs3nmML3dMRNmEYpiyVNBm2",
    );
    expect(getNetworkConfig("mainnet", { applyEnvOverrides: false }).sns?.rootDomain).toBe(
      "58PwtjSDuFHuUkYjH9BYod9SZaELfsvdrNMryy9iYNvo",
    );
    expect(getNetworkConfig("testnet", { applyEnvOverrides: false }).sns).toBeUndefined();
  });

  it("keeps exact network links canonical", () => {
    expect(hrefWithChain("/vault/deposit", "devnet-regtest")).toBe(
      "/vault/deposit?chain=sol&network=devnet-regtest",
    );
  });
});
