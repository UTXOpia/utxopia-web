import { describe, expect, it } from "bun:test";
import { GET, POST } from "./route";
import { faucetBackendUrl } from "@/lib/server/faucet-backend";
import { getNetworkConfig } from "@/lib/network-config";
import { getVaultNetworkConfig, parseVaultId } from "@/lib/vault-config";
import type { NetworkConfig } from "@/lib/network-config";

function request(body: Record<string, unknown>): Request {
  return new Request("https://app.utxopia.test/api/faucet/regtest?network=devnet-regtest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

function getRequest(query = ""): Request {
  return new Request(
    `https://app.utxopia.test/api/faucet/regtest?network=devnet-regtest${query}`,
    { cache: "no-store" },
  );
}

describe("regtest BTC deposit faucet", () => {
  it("rejects the legacy address field", async () => {
    const response = await POST(request({
      address: `utxo:${"11".repeat(96)}`,
      amountSats: 100_000,
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "stealthAddress must be a UTXOpia private address",
    });
  });

  it("rejects a raw regtest BTC recipient", async () => {
    const response = await POST(request({
      stealthAddress: `bcrt1q${"a".repeat(38)}`,
      amountSats: 100_000,
    }) as never);

    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({
      ok: false,
      error: "stealthAddress must be a UTXOpia private address",
    });
  });

  it("cannot be enabled by request state on a mainnet deployment", async () => {
    const previousNetwork = process.env.UTXOPIA_BITCOIN_NETWORK;
    process.env.UTXOPIA_BITCOIN_NETWORK = "mainnet";
    try {
      const response = await POST(request({
        stealthAddress: `utxo:${"11".repeat(96)}`,
        amountSats: 100_000,
      }) as never);

      expect(response.status).toBe(404);
      expect(await response.json()).toMatchObject({
        ok: false,
        error: "regtest faucet is not deployed on this Bitcoin network",
      });
    } finally {
      if (previousNetwork === undefined) delete process.env.UTXOPIA_BITCOIN_NETWORK;
      else process.env.UTXOPIA_BITCOIN_NETWORK = previousNetwork;
    }
  });

  it("reports the remaining daily allowance without spending one", async () => {
    const stealthAddress = `utxo:${"22".repeat(96)}`;

    const first = await GET(getRequest(`&stealthAddress=${stealthAddress}`) as never);
    expect(first.status).toBe(200);
    const before = await first.json();
    expect(before).toMatchObject({ dailyLimit: 3, used: 0, remaining: 3 });

    // Asking again must not consume the allowance it is reporting.
    const second = await GET(getRequest(`&stealthAddress=${stealthAddress}`) as never);
    expect(await second.json()).toMatchObject({ used: 0, remaining: 3 });
  });

  it("still answers callers that only want the funding address", async () => {
    const response = await GET(getRequest() as never);
    expect(response.status).toBe(200);
    expect(await response.json()).toHaveProperty("address");
  });
});

describe("faucet backend routing", () => {
  const network = "devnet-regtest" as const;
  const scoped = (vault: string) =>
    getVaultNetworkConfig(
      network,
      getNetworkConfig(network, { applyEnvOverrides: false }) as NetworkConfig,
      parseVaultId(vault),
    );

  // Open and Verified are separate backend processes, each validating the
  // deposit against its own POOL_RECEIVE_ADDRESS, and the shared host routes an
  // unprefixed path to Open. Losing the vault here sends a Verified deposit to
  // Open, which answers "faucet configuration is outdated".
  it("sends each vault's deposit to that vault's own backend", () => {
    expect(faucetBackendUrl(network, scoped("verified"))).toContain("/verified");
    expect(faucetBackendUrl(network, scoped("open"))).toContain("/open");
  });

  it("does not silently fall back to the unscoped host when a vault is known", () => {
    const unscoped = faucetBackendUrl(network, null);
    expect(faucetBackendUrl(network, scoped("verified"))).not.toBe(unscoped);
  });
  // A host override must not quietly undo vault scoping: dropping the prefix
  // sends a Verified deposit to Open and resurrects the "outdated" error.
  it("carries the vault prefix across a backend host override", () => {
    const prev = process.env.REGTEST_FAUCET_BACKEND_URL;
    process.env.REGTEST_FAUCET_BACKEND_URL = "https://api.example.test";
    try {
      expect(faucetBackendUrl(network, scoped("verified"))).toBe(
        "https://api.example.test/verified",
      );
      expect(faucetBackendUrl(network, null)).toBe("https://api.example.test");
    } finally {
      if (prev === undefined) delete process.env.REGTEST_FAUCET_BACKEND_URL;
      else process.env.REGTEST_FAUCET_BACKEND_URL = prev;
    }
  });
});
