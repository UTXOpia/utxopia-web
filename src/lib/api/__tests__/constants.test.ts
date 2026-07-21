import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { API_ENDPOINTS, getBackendUrl } from "../constants";

describe("API_ENDPOINTS", () => {
  it("routes public zkBTC balances to the explicitly selected network", () => {
    expect(API_ENDPOINTS.PUBLIC_ZKBTC_BALANCE("wallet/address", "devnet-regtest")).toBe(
      "/api/public-zkbtc-balance?owner=wallet%2Faddress&network=devnet-regtest",
    );
  });
});

describe("getBackendUrl", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    delete process.env.BACKEND_API_URL;
    delete process.env.NEXT_PUBLIC_BACKEND_API_URL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns a valid URL when no env vars set", () => {
    const url = getBackendUrl();
    // Should return either networks.json config or DEFAULT_API_URL
    expect(url).toBeTruthy();
    expect(url.startsWith("http")).toBe(true);
  });

  it("uses NEXT_PUBLIC_BACKEND_API_URL on client side", () => {
    process.env.NEXT_PUBLIC_BACKEND_API_URL = "https://custom-api.example.com";
    expect(getBackendUrl()).toBe("https://custom-api.example.com");
  });
});
