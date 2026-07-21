/** @happy-dom */
import { describe, it, expect, mock, beforeEach, afterEach } from "bun:test";
import { render, fireEvent, screen, cleanup } from "@testing-library/react";

const originalFetch = global.fetch;

beforeEach(() => {
  global.fetch = mock(() =>
    Promise.resolve({ ok: false, json: async () => null } as Response),
  ) as typeof fetch;
});

afterEach(() => {
  global.fetch = originalFetch;
  cleanup();
});

// Stub the hooks the form depends on so the test stays unit-scoped.
mock.module("@/hooks/use-utxopia", () => ({
  useUTXOpia: () => ({
    keys: null,
    stealthAddress: null,
    hasKeys: false,
    inboxNotes: [],
    refreshInbox: () => {},
    refreshPublicBalance: () => {},
  }),
  useTokenNotes: () => ({
    availableNotes: [],
    totalBalance: 0n,
    isLoading: false,
  }),
}));
mock.module("@/hooks/use-token-prices", () => ({
  useTokenPrices: () => ({ btc: 50000, sol: null, usdc: null, usdt: null }),
}));
mock.module("@/hooks/use-note-auto-selector", () => ({
  useNoteAutoSelector: () => ({
    availableNotes: [],
    selectedNotes: [],
    totalAvailable: 0,
    totalSelected: 0,
    isLoading: false,
    refresh: () => {},
    hasNotes: false,
  }),
}));
mock.module("@/hooks/use-joinsplit-submit", () => ({
  useJoinSplitSubmit: () => ({
    status: "idle",
    statusMessage: "",
    txSignature: null,
    error: null,
    submit: async () => ({ success: false, signature: null }),
    reset: () => {},
  }),
}));
mock.module("@/hooks/use-sns-name", () => ({
  useSnsName: () => ({
    lookupSnsName: async () => null,
    registeredSnsName: null,
    hasRegisteredSnsName: false,
    needsUpdate: false,
    isLoading: false,
    isRegistering: false,
    error: null,
    lookupMySnsName: async () => {},
    isNameRegistered: async () => false,
    registerSnsSubdomain: async () => false,
    updateSnsStealthData: async () => false,
  }),
}));
// Note: not mocking @/hooks/use-relayer-config — bun's mock.module is global,
// and use-relayer-config.test.ts imports the real hook. Real useRelayerConfig
// is render-safe (initial state returns defaults; fetch fires in useEffect).
mock.module("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ publicKey: null }),
}));
mock.module("next/navigation", () => ({
  useRouter: () => ({ push: () => {} }),
}));
mock.module("./review-modal", () => ({
  ReviewModal: () => null,
}));
mock.module("./claim-link-modal", () => ({
  ClaimLinkModal: () => null,
}));

import { SendForm } from "./send-form";

describe("SendForm", () => {
  it("renders the recipient input first; amount and review hidden until valid", () => {
    render(<SendForm />);
    expect(screen.getByPlaceholderText(/paste an address/i)).toBeDefined();
    expect(screen.queryByLabelText(/^amount$/i)).toBeNull();
    expect(
      screen.queryByRole("button", { name: /^send$/i }),
    ).toBeNull();
  });

  it("reveals the amount field after a valid recipient is entered", () => {
    render(<SendForm />);
    fireEvent.change(screen.getByPlaceholderText(/paste an address/i), {
      target: { value: "bc1q9d4ywgfnd8h70q4thlsclpw0ymmqfumzgxlhpe" },
    });
    expect(screen.getByLabelText(/^amount$/i)).toBeDefined();
  });

  it("lets cash-out users choose Bitcoin or Solana and validates the selected network", () => {
    render(<SendForm mode="cashout" />);
    expect(screen.getByLabelText(/^amount$/i)).toBeDefined();
    expect(screen.getByText("Sign in to view")).toBeDefined();
    expect(screen.getAllByText("BTC").length).toBeGreaterThan(0);
    expect(screen.getByText("Private balance")).toBeDefined();
    expect(screen.queryByText("zkBTC")).toBeNull();

    const bitcoinAddress = "bc1q9d4ywgfnd8h70q4thlsclpw0ymmqfumzgxlhpe";
    fireEvent.change(screen.getByLabelText(/bitcoin address/i), {
      target: { value: bitcoinAddress },
    });
    expect(screen.getByLabelText(/^amount$/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /solana receive in a wallet/i }));
    expect((screen.getByLabelText(/solana wallet address/i) as HTMLInputElement).value).toBe("");
    expect(screen.getByLabelText(/^amount$/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText(/solana wallet address/i), {
      target: { value: bitcoinAddress },
    });
    expect(screen.getByText("Enter a valid Solana wallet address")).toBeDefined();
    expect(screen.getByLabelText(/^amount$/i)).toBeDefined();

    fireEvent.change(screen.getByLabelText(/solana wallet address/i), {
      target: { value: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM" },
    });
    expect(screen.getByLabelText(/^amount$/i)).toBeDefined();
  });
});
