import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SplTestFundsHelper } from "./test-funds-helper";

const originalFetch = globalThis.fetch;

afterEach(() => {
  cleanup();
  mock.restore();
  globalThis.fetch = originalFetch;
});

describe("SplTestFundsHelper", () => {
  it("gets the selected public test token and refreshes the balance", async () => {
    const refresh = mock(() => {});
    const fetchMock = mock(() => Promise.resolve(new Response(
      JSON.stringify({ ok: true, signature: "sig" }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    )));
    globalThis.fetch = fetchMock as typeof fetch;

    render(
      <SplTestFundsHelper
        token="USDC"
        networkId="devnet-regtest"
        recipient="11111111111111111111111111111111"
        onBalanceRefresh={refresh}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Get test USDC" }));

    await waitFor(() => {
      expect(screen.getByText("10 test USDC was sent to your connected wallet.")).toBeDefined();
    });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/faucet/spl?network=devnet-regtest",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          recipient: "11111111111111111111111111111111",
          token: "USDC",
          amount: 10,
        }),
      }),
    );
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("turns a non-JSON faucet response into a useful inline error", async () => {
    globalThis.fetch = mock(() => Promise.resolve(
      new Response("<!DOCTYPE html>", { status: 502 }),
    )) as typeof fetch;

    render(
      <SplTestFundsHelper
        token="USDT"
        networkId="devnet-regtest"
        recipient="11111111111111111111111111111111"
        onBalanceRefresh={() => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Get test USDT" }));

    await waitFor(() => {
      expect(screen.getByText("Faucet returned an invalid response (HTTP 502).")).toBeDefined();
    });
  });
});
