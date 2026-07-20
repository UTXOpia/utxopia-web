import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { isSameOrigin, requestOrigin } from "./proxy";

describe("API origin checks", () => {
  it("accepts a browser Origin header matching the served application", () => {
    expect(isSameOrigin("http://localhost:3000", "http://localhost:3000")).toBe(true);
    expect(isSameOrigin("https://alpha.utxopia.com", "https://alpha.utxopia.com/path")).toBe(true);
  });

  it("does not treat a different scheme, host, or port as same-origin", () => {
    expect(isSameOrigin("https://alpha.utxopia.com", "http://alpha.utxopia.com")).toBe(false);
    expect(isSameOrigin("http://localhost:3001", "http://localhost:3000")).toBe(false);
    expect(isSameOrigin("https://evil.example", "https://alpha.utxopia.com")).toBe(false);
  });

  it("uses the public Host header instead of the server bind address", () => {
    const request = new NextRequest("http://0.0.0.0:3000/api/faucet/regtest", {
      headers: { "x-forwarded-host": "localhost:3000" },
    });
    expect(requestOrigin(request)).toBe("http://localhost:3000");
  });
});
