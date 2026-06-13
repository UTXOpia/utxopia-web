import { afterEach, describe, expect, it } from "bun:test";
import { applyBackendAuthHeaders, getBackendApiKey } from "./backend-auth";

const ENV_NAMES = [
  "BACKEND_API_KEY",
  "REGTEST_FAUCET_BACKEND_API_KEY",
  "UTXOPIA_BACKEND_API_KEY",
] as const;

function clearEnv() {
  for (const name of ENV_NAMES) {
    delete process.env[name];
  }
}

describe("backend auth headers", () => {
  afterEach(clearEnv);

  it("prefers BACKEND_API_KEY", () => {
    clearEnv();
    process.env.BACKEND_API_KEY = "backend";
    process.env.REGTEST_FAUCET_BACKEND_API_KEY = "faucet";

    expect(getBackendApiKey()).toBe("backend");
  });

  it("supports faucet-specific backend key deployments", () => {
    clearEnv();
    process.env.REGTEST_FAUCET_BACKEND_API_KEY = "faucet";

    expect(applyBackendAuthHeaders({ "Content-Type": "application/json" })).toEqual({
      "Content-Type": "application/json",
      "X-API-Key": "faucet",
    });
  });

  it("omits X-API-Key when no backend secret is configured", () => {
    clearEnv();

    expect(applyBackendAuthHeaders({ "Content-Type": "application/json" })).toEqual({
      "Content-Type": "application/json",
    });
  });
});

