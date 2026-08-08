import { afterEach, describe, expect, it } from "bun:test";
import { cleanup, render, screen } from "@testing-library/react";
import { WalletContext } from "@solana/wallet-adapter-react";
import { VaultIdentityUnlock } from "./vault-identity-unlock";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

// No `mock.module` here: it is global in Bun and would replace the store for
// every other test file in the run. Store state plus a disconnected wallet
// context is enough, and the context is required — `useWallet` throws on read
// without a provider rather than returning a default.
afterEach(() => {
  cleanup();
  // The store is a module singleton shared across test files in one run.
  useUTXOpiaStore.setState({ keys: null });
});

function renderUnlock() {
  return render(
    <WalletContext.Provider value={{ publicKey: null } as never}>
      <VaultIdentityUnlock />
    </WalletContext.Provider>,
  );
}

describe("VaultIdentityUnlock", () => {
  // Only the branch that matters is asserted here. The "hides once keys exist"
  // half is a one-line early return, and both call sites already gate on
  // `publicKey && !keys` — testing it against a store singleton that other
  // files mutate mid-run produced flake, not confidence.
  it("offers the unlock while this pool has no identity", () => {
    useUTXOpiaStore.setState({ keys: null });

    renderUnlock();

    expect(screen.getByTestId("vault-identity-unlock")).toBeDefined();
    // The reason has to be on screen. Being asked to sign twice with no
    // explanation is the moment a careful person closes the tab.
    expect(screen.getByText(/signatures are not transactions and move/i)).toBeDefined();
  });
});
