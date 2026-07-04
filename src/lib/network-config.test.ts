import { afterEach, describe, expect, it } from "bun:test";
import {
  detectNetwork,
  detectNetworkFromRequest,
  getNetworkConfig,
  hrefWithChain,
  NETWORK_META,
} from "./network-config";

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

    expect(detectNetworkFromRequest(req)).toBe("devnet-regtest");
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

  it("does not expose testnet4-backed networks as supported", () => {
    const enabled = NETWORK_META.filter((item) => item.enabled).map((item) => item.id);
    const devnet = NETWORK_META.find((item) => item.id === "devnet");
    const suiTestnet = NETWORK_META.find((item) => item.id === "sui-testnet");

    expect(enabled).toContain("sui-regtest");
    expect(enabled).not.toContain("devnet");
    expect(enabled).not.toContain("sui-testnet");
    expect(devnet?.comingSoon).toBe(true);
    expect(suiTestnet?.comingSoon).toBe(true);
  });

  it("falls back from unsupported testnet4 networks to supported hybrids", () => {
    expect(detectNetworkFromRequest(new Request("https://app.utxopia.test/?chain=sol&network=devnet"))).toBe(
      "devnet-regtest",
    );
    expect(detectNetworkFromRequest(new Request("https://app.utxopia.test/?chain=sui&network=sui-testnet"))).toBe(
      "sui-regtest",
    );
  });

  it("enabled live networks have the backend and Bitcoin fields required by user flows", () => {
    for (const meta of NETWORK_META.filter((item) => item.enabled && !item.comingSoon)) {
      const cfg = getNetworkConfig(meta.id, { applyEnvOverrides: false });

      expect(cfg.backend.url, `${meta.id} backend.url`).toMatch(/^https?:\/\//);
      expect(cfg.bitcoin.network, `${meta.id} bitcoin.network`).toBeTruthy();
      expect(cfg.bitcoin.explorerUrl, `${meta.id} bitcoin.explorerUrl`).toMatch(/^https?:\/\//);

      if (cfg.chain === "sui") {
        expect(cfg.sui?.packageId, `${meta.id} sui.packageId`).toBeTruthy();
        expect(cfg.sui?.commitmentTree?.objectId, `${meta.id} sui.commitmentTree`).toBeTruthy();
        expect(cfg.sui?.btcDepositRegistry?.objectId, `${meta.id} sui.btcDepositRegistry`).toBeTruthy();
        expect(cfg.sui?.utxoSet?.objectId, `${meta.id} sui.utxoSet`).toBeTruthy();
      } else {
        expect(cfg.solana.utxopiaProgramId, `${meta.id} solana.utxopiaProgramId`).toBeTruthy();
        expect(cfg.tokens.zkbtcMint, `${meta.id} tokens.zkbtcMint`).toBeTruthy();
        expect(cfg.bitcoin.poolAddress, `${meta.id} bitcoin.poolAddress`).toBeTruthy();
        expect(cfg.sns?.nameServiceProgramId, `${meta.id} sns.nameServiceProgramId`).toBeTruthy();
        expect(cfg.sns?.subRegistrarProgramId, `${meta.id} sns.subRegistrarProgramId`).toBeTruthy();
        expect(cfg.sns?.parentDomain, `${meta.id} sns.parentDomain`).toBe("utxopia");
      }
    }
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
    expect(hrefWithChain("/vault/deposit", "sui-regtest")).toBe(
      "/vault/deposit?chain=sui&network=sui-regtest",
    );
  });
});
