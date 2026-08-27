import { describe, expect, it } from "bun:test";
import { getTokenBySymbol } from "./supported-tokens";

describe("getTokenBySymbol", () => {
  it("resolves a symbol whatever case the caller has", () => {
    expect(getTokenBySymbol("BTC")?.symbol).toBe("BTC");
    expect(getTokenBySymbol("btc")?.symbol).toBe("BTC");
    expect(getTokenBySymbol("Usdc")?.symbol).toBe("USDC");
  });

  it("resolves a shielded symbol to the underlying asset, not its own entry", () => {
    // /pool/zkbtc and /pool/btc are the same pool; the route slug is lowercase.
    expect(getTokenBySymbol("zkbtc")?.symbol).toBe("BTC");
    expect(getTokenBySymbol("zkBTC")?.symbol).toBe("BTC");
    expect(getTokenBySymbol("zkSOL")?.symbol).toBe("SOL");
  });

  it("returns undefined for an unknown symbol rather than a default", () => {
    expect(getTokenBySymbol("nope")).toBeUndefined();
    expect(getTokenBySymbol("")).toBeUndefined();
  });
});
