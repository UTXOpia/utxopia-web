import { describe, expect, it } from "bun:test";
import {
  getEsploraApiUrl,
  getBtcSignerNetwork,
  getMempoolExplorerUrl,
  getSatsConnectNetwork,
  getUnisatChain,
  getUnisatFallbackNetwork,
  scriptToAddress,
} from "./btc-network";

describe("btc-network URL helpers", () => {
  it("derives Esplora API URLs from the selected app network", () => {
    expect(getEsploraApiUrl("devnet")).toBe("https://mempool.space/testnet4/api");
    expect(getEsploraApiUrl("devnet-regtest")).toBe("https://btc.utxopia.com/regtest/api");
  });

  it("keeps explorer links separate from API URLs", () => {
    expect(getMempoolExplorerUrl("devnet-regtest")).toBe("https://btc.utxopia.com/regtest");
  });

  it("derives wallet prompt networks from the selected app network", () => {
    expect(getSatsConnectNetwork("devnet-regtest")).toBe("Testnet");
    expect(getUnisatChain("devnet")).toBe("BITCOIN_TESTNET4");
    expect(getUnisatChain("devnet-regtest")).toBe("BITCOIN_REGTEST");
    expect(getUnisatFallbackNetwork("mainnet")).toBe("livenet");
  });

  it("maps active app networks to the BTC signer network", () => {
    expect(getBtcSignerNetwork("mainnet")).toBe("mainnet");
    expect(getBtcSignerNetwork("devnet")).toBe("testnet");
    expect(getBtcSignerNetwork("devnet-regtest")).toBe("regtest");
  });

  it("decodes witness scripts with the selected Bitcoin network HRP", () => {
    const p2trScript = `5120${"11".repeat(32)}`;

    expect(scriptToAddress(p2trScript, "devnet")).toMatch(/^tb1p/);
    expect(scriptToAddress(p2trScript, "devnet-regtest")).toMatch(/^bcrt1p/);
    expect(scriptToAddress(p2trScript, "mainnet")).toMatch(/^bc1p/);
  });
});
