import { describe, expect, it } from "bun:test";
import { PublicKey } from "@solana/web3.js";
import { getNetworkConfig } from "@/lib/network-config";
import {
  deriveParentDomainKey,
  deriveSubdomainKey,
  getSnsConfig,
  isSnsSubdomainRegistered,
  resolveSnsNameForNetwork,
  SNS_HEADER_SIZE,
} from "./sns";

describe("network-scoped SNS helpers", () => {
  it("returns SNS config only for configured Solana networks", () => {
    expect(getSnsConfig(getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }))).toBeTruthy();
    expect(getSnsConfig(getNetworkConfig("sui-regtest", { applyEnvOverrides: false }))).toBeNull();
  });

  it("resolves names using the provided SNS network config", async () => {
    const sns = getSnsConfig(getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }));
    expect(sns).toBeTruthy();
    if (!sns) return;

    const parentKey = deriveParentDomainKey(sns);
    const subdomainKey = deriveSubdomainKey("alice", parentKey, sns);
    const viewingPubKey = new Uint8Array(32).fill(1);
    const mpk = new Uint8Array(32).fill(2);
    const data = new Uint8Array(SNS_HEADER_SIZE + 65);
    data[SNS_HEADER_SIZE] = 2;
    data.set(viewingPubKey, SNS_HEADER_SIZE + 1);
    data.set(mpk, SNS_HEADER_SIZE + 33);

    const requestedKeys: string[] = [];
    const resolved = await resolveSnsNameForNetwork(
      {
        getAccountInfo: async (key: PublicKey) => {
          requestedKeys.push(key.toBase58());
          return key.equals(subdomainKey) ? { data } : null;
        },
      },
      "alice.utxopia.sol",
      sns,
    );

    expect(requestedKeys).toEqual([subdomainKey.toBase58()]);
    expect(resolved?.fullDomain).toBe("alice.utxopia.sol");
    expect(resolved?.version).toBe(2);
    expect(Array.from(resolved?.viewingPubKey ?? [])).toEqual(Array.from(viewingPubKey));
    expect(Array.from(resolved?.mpk ?? [])).toEqual(Array.from(mpk));
  });

  it("checks registration by raw SNS account existence", async () => {
    const sns = getSnsConfig(getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }));
    expect(sns).toBeTruthy();
    if (!sns) return;

    const parentKey = deriveParentDomainKey(sns);
    const subdomainKey = deriveSubdomainKey("alice", parentKey, sns);

    const registered = await isSnsSubdomainRegistered(
      {
        getAccountInfo: async (key: PublicKey) => key.equals(subdomainKey) ? { data: new Uint8Array() } : null,
      },
      "alice.utxopia.sol",
      sns,
    );

    expect(registered).toBe(true);
  });
});
