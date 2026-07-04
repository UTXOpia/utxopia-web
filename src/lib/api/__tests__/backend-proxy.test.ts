import { afterEach, describe, expect, it, mock } from "bun:test";
import { proxyToBackend } from "../backend-proxy";

describe("backend proxy", () => {
  const originalFetch = global.fetch;
  const originalTimeout = process.env.BACKEND_PROXY_TIMEOUT_MS;

  afterEach(() => {
    global.fetch = originalFetch;
    if (originalTimeout === undefined) {
      delete process.env.BACKEND_PROXY_TIMEOUT_MS;
    } else {
      process.env.BACKEND_PROXY_TIMEOUT_MS = originalTimeout;
    }
  });

  it("forwards requests to the selected network backend", async () => {
    const fetchMock = mock(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe("https://api-hybrid.utxopia.com/api/tree/status?network=devnet-regtest");
      return Response.json({ synced: true });
    });
    global.fetch = fetchMock as any;

    const response = await proxyToBackend(
      new Request("https://app.utxopia.test/api/tree/status?network=devnet-regtest"),
      "/api/tree/status",
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ synced: true });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("returns a structured timeout instead of hanging", async () => {
    process.env.BACKEND_PROXY_TIMEOUT_MS = "5";
    global.fetch = mock((_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => {
          reject(new DOMException("This operation was aborted", "AbortError"));
        });
      });
    }) as any;

    const response = await proxyToBackend(
      new Request("https://app.utxopia.test/api/tree/status?network=devnet-regtest"),
      "/api/tree/status",
    );
    const json = await response.json();

    expect(response.status).toBe(504);
    expect(json).toMatchObject({
      success: false,
      code: "BACKEND_TIMEOUT",
      network: "devnet-regtest",
      backendHost: "api-hybrid.utxopia.com",
    });
  });
});
