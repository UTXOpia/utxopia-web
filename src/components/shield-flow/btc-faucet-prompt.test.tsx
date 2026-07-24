import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { BtcFaucetPrompt } from "./btc-faucet-prompt";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

afterEach(cleanup);

describe("BtcFaucetPrompt", () => {
  it("renders the private BTC faucet directly inside Add funds", () => {
    useUTXOpiaStore.setState({
      stealthAddressEncoded: `utxo:${"a".repeat(192)}`,
      inboxBalancesByToken: { zkBTC: 0n },
    });

    render(
      <BtcFaucetPrompt
        networkId="devnet-regtest"
        tokenSelector={<button type="button">BTC</button>}
      />,
    );

    expect(screen.getByRole("spinbutton", { name: "Amount (sats)" })).toBeDefined();
    expect(screen.getByRole("button", { name: "Get private test BTC" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Get private test BTC" })).toBeNull();
  });
});
