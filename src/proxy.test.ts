import { describe, expect, it } from "bun:test";
import { NextRequest } from "next/server";
import { isSameOrigin, proxy, requestOrigin } from "./proxy";
import { NETWORK_META, getNetworkConfig } from "@/lib/network-config";

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

describe("Content-Security-Policy", () => {
  function connectSrc(): string[] {
    const res = proxy(new NextRequest("https://app.utxopia.com/"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const directive = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("connect-src "));
    return (directive ?? "").replace("connect-src ", "").split(/\s+/).filter(Boolean);
  }

  it("allows the hosts the browser actually talks to", () => {
    const sources = connectSrc();
    for (const host of [
      "'self'",
      "https://api.utxopia.com",
      "https://api-regtest.utxopia.com",
      "https://btc.utxopia.com",
      "https://circuit.utxopia.com",
    ]) {
      expect(sources).toContain(host);
    }
  });

  it("covers the backend of every network the picker offers", () => {
    // Enabling testnet4 added a network whose backend origin was not listed, so
    // the browser could reach the app and not its own API. Derive the
    // expectation from NETWORK_META rather than restating hostnames, or the
    // next environment repeats it.
    const sources = connectSrc();
    for (const meta of NETWORK_META.filter((m) => m.enabled && !m.comingSoon)) {
      const url = getNetworkConfig(meta.id, { applyEnvOverrides: false }).backend.url;
      if (!url) continue;
      expect(sources, `${meta.id} backend origin missing from connect-src`).toContain(
        new URL(url).origin,
      );
    }
  });

  function directive(name: string): string[] {
    const res = proxy(new NextRequest("https://app.utxopia.com/"));
    const csp = res.headers.get("Content-Security-Policy") ?? "";
    const found = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith(`${name} `));
    return (found ?? "").replace(`${name} `, "").split(/\s+/).filter(Boolean);
  }

  it("lets social login reach Privy, in both directions it needs", () => {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    process.env.NEXT_PUBLIC_PRIVY_APP_ID = "test-app-id";
    try {
      // The API call and the embedded wallet's iframe are the same host under
      // two directives. Allowing only one of them fails as a console error the
      // sign-in UI has no way to report.
      expect(connectSrc()).toContain("https://auth.privy.io");
      expect(directive("frame-src")).toContain("https://auth.privy.io");
    } finally {
      if (appId === undefined) delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
      else process.env.NEXT_PUBLIC_PRIVY_APP_ID = appId;
    }
  });

  it("names no third party a deployment did not configure", () => {
    const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    delete process.env.NEXT_PUBLIC_PRIVY_APP_ID;
    try {
      // An allowed origin on the page that holds spending keys is a route out.
      // Without Privy configured there is nothing to allow, so nothing is.
      expect(connectSrc().some((s) => s.includes("privy.io"))).toBe(false);
      expect(directive("frame-src")).toEqual(["'self'"]);
    } finally {
      if (appId !== undefined) process.env.NEXT_PUBLIC_PRIVY_APP_ID = appId;
    }
  });

  it("does not wildcard the org's own domain", () => {
    // This page holds spending keys, so every allowed origin is a possible exfiltration route.
    // A `*.utxopia.com` wildcard would extend that trust to any subdomain the org ever creates
    // or loses to a dangling DNS record.
    expect(connectSrc()).not.toContain("https://*.utxopia.com");
  });

  it("allows no third-party wildcard outside the RPC providers", () => {
    // A wildcard for an unrelated third-party domain sat here long after that domain stopped
    // being used, pre-authorising whoever registered it next. Wildcards are only tolerable for
    // the RPC vendors we cannot enumerate.
    const unexpected = connectSrc().filter(
      (s) => s.includes("*") && !/rpcpool\.com|helius-rpc\.com/.test(s),
    );
    expect(unexpected).toEqual([]);
  });
});
