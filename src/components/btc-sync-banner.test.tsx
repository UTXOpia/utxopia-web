/** @happy-dom */
import { afterEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { getNetworkConfig } from "@/lib/network-config";

mock.module("@/lib/chain-environment", () => ({
  useChainEnvironment: () => ({
    networkId: "devnet",
    config: getNetworkConfig("devnet", { applyEnvOverrides: false }),
  }),
}));

import { BtcSyncBanner } from "./btc-sync-banner";

/** The banner's whole job is deciding when to be silent, so every case here is
 *  about which side of that line a status lands on. */
function mockStatus(body: unknown, ok = true) {
  globalThis.fetch = mock(async () => ({
    ok,
    json: async () => body,
  })) as unknown as typeof fetch;
}

afterEach(() => cleanup());

describe("BtcSyncBanner", () => {
  it("warns, and names the consequence, when the light client is behind", async () => {
    mockStatus({
      enabled: true,
      tip_height: 149889,
      finalized_height: 149884,
      btc_tip: 150086,
      blocks_behind: 197,
      synced: false,
    });
    render(<BtcSyncBanner />);

    const alert = await screen.findByRole("alert");
    // devnet is testnet4, and the banner must say so — three chains are
    // selectable and only one of them is behind.
    expect(alert.textContent).toContain("Bitcoin testnet4 sync is behind");
    // The numbers matter less than telling the user what it costs them.
    expect(alert.textContent).toContain("197");
    expect(alert.textContent).toContain("cannot be credited");
  });

  it("renders nothing while synced", async () => {
    mockStatus({ enabled: true, tip_height: 150088, btc_tip: 150088, blocks_behind: 0, synced: true });
    const { container } = render(<BtcSyncBanner />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
    expect(container.textContent).toBe("");
  });

  it("renders nothing when header relay is not configured", async () => {
    mockStatus({ enabled: false, reason: "header relay is not configured on this instance" });
    render(<BtcSyncBanner />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });

  /// Bitcoin being unreachable is still worth showing: it is the case where the
  /// light client may be fine and the operator cannot tell.
  it("surfaces a light-client read error", async () => {
    mockStatus({ enabled: true, error: "light client account is not initialized" });
    render(<BtcSyncBanner />);
    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("not initialized");
  });

  it("stays quiet when the status endpoint itself fails", async () => {
    mockStatus({}, false);
    render(<BtcSyncBanner />);
    await waitFor(() => expect(globalThis.fetch).toHaveBeenCalled());
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
