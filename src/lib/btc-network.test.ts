import { describe, expect, it } from "bun:test";
import { getEsploraApiUrl, getMempoolExplorerUrl } from "./btc-network";

describe("btc-network URL helpers", () => {
  it("derives Esplora API URLs from the selected app network", () => {
    expect(getEsploraApiUrl("devnet")).toBe("https://mempool.space/testnet4/api");
    expect(getEsploraApiUrl("devnet-regtest")).toBe("https://btc.utxopia.com/regtest/api");
    expect(getEsploraApiUrl("sui-regtest")).toBe("https://btc.utxopia.com/regtest/api");
  });

  it("keeps explorer links separate from API URLs", () => {
    expect(getMempoolExplorerUrl("devnet-regtest")).toBe("https://btc.utxopia.com/regtest");
  });
});
