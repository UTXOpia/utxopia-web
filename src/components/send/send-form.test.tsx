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
  mockPublicKey = null;
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
  useTokenPrices: () => ({ btc: 50000, sol: 100, usdc: 1, usdt: 1 }),
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
// Mutable so a test can render the connected-wallet path; reset in afterEach.
let mockPublicKey: { toBase58: () => string } | null = null;
mock.module("@solana/wallet-adapter-react", () => ({
  useWallet: () => ({ publicKey: mockPublicKey }),
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
import { useUTXOpiaStore } from "@/stores/utxopia-store";

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

  // Switching Open <-> Verified drops the old keys before the new ones derive.
  // The form used to read that gap as signed out and say so, to somebody who
  // had just clicked a control only a signed-in member can see — three labels
  // for one click, the first of them untrue.
  it("does not tell a member to sign in while their vault is being switched", () => {
    useUTXOpiaStore.setState({ identityRestoring: true });
    try {
      render(<SendForm mode="cashout" />);
      expect(screen.queryByText("Sign in to view")).toBeNull();
      expect(screen.getAllByText("Loading…").length).toBeGreaterThan(0);
    } finally {
      useUTXOpiaStore.setState({ identityRestoring: false });
    }
  });

  it("lets cash-out users choose Bitcoin or Solana and validates the selected network", () => {
    render(<SendForm mode="cashout" />);
    expect(screen.getByLabelText(/^amount$/i)).toBeDefined();
    expect(screen.getByText("Sign in to view")).toBeDefined();
    expect(screen.getAllByText("BTC").length).toBeGreaterThan(0);
    expect(screen.getByText(/from your private balance/i)).toBeDefined();
    expect(screen.queryByText("zkBTC")).toBeNull();

    const bitcoinAddress = "bc1q9d4ywgfnd8h70q4thlsclpw0ymmqfumzgxlhpe";
    fireEvent.change(screen.getByLabelText(/bitcoin address/i), {
      target: { value: bitcoinAddress },
    });
    expect(screen.getByLabelText(/^amount$/i)).toBeDefined();

    fireEvent.click(screen.getByRole("button", { name: /solana cash out/i }));
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

  it("offers the connected wallet as the Solana cash-out destination, and lets it be changed", () => {
    const wallet = "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM";
    mockPublicKey = { toBase58: () => wallet };
    render(<SendForm mode="cashout" />);

    fireEvent.click(screen.getByRole("button", { name: /solana cash out/i }));
    expect(screen.getByText("My connected wallet")).toBeDefined();
    // Collapsed: no empty box to paste into until the user asks for one.
    expect(screen.queryByLabelText(/solana wallet address/i)).toBeNull();

    fireEvent.click(screen.getByTestId("edit-destination"));
    const input = screen.getByLabelText(/solana wallet address/i) as HTMLInputElement;
    expect(input.value).toBe(wallet);

    fireEvent.change(input, { target: { value: "5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1" } });
    expect(screen.queryByText("My connected wallet")).toBeNull();

    // ...and one tap gets the connected wallet back.
    fireEvent.click(screen.getByTestId("use-connected-wallet"));
    expect(screen.getByText("My connected wallet")).toBeDefined();
  });

  it("uses the selected cash-out asset price for the USD preview", () => {
    render(<SendForm mode="cashout" />);

    fireEvent.click(screen.getByRole("button", { name: /solana cash out/i }));
    // The asset picker now lives inside the amount field: the trigger is a
    // bare symbol pill, and only the menu rows carry the "Private balance" hint.
    fireEvent.click(screen.getByRole("button", { name: "BTC" }));
    fireEvent.click(screen.getByRole("button", { name: /sol private balance/i }));
    fireEvent.change(screen.getByLabelText(/^amount$/i), {
      target: { value: "0.05" },
    });

    expect(screen.getByText("≈ $5.00")).toBeDefined();
    expect(screen.queryByText("≈ $2500.00")).toBeNull();
  });
});
