import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { VaultActions } from "./vault-actions";

afterEach(cleanup);

describe("VaultActions", () => {
  it("keeps faucet out of the primary action group", () => {
    render(
      <VaultActions
        networkId="devnet-regtest"
        vaultId="open"
        isViewOnly={false}
        depositCount={0}
      />,
    );

    expect(screen.getByRole("link", { name: "Add funds" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Send privately" })).toBeDefined();
    expect(screen.getByRole("link", { name: "Take funds out" })).toBeDefined();
    expect(screen.queryByRole("link", { name: "Faucet" })).toBeNull();
  });
});
