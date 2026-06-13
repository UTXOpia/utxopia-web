/** @happy-dom */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { getNetworkConfig, type NetworkId } from "@/lib/network-config";

let mockedNetwork: NetworkId = "devnet-regtest";
let registerSnsSubdomain = async () => true;
let snsError: string | null = null;

mock.module("@/lib/chain-environment", () => ({
  useChainEnvironment: () => ({
    networkId: mockedNetwork,
    config: getNetworkConfig(mockedNetwork, { applyEnvOverrides: false }),
  }),
}));

mock.module("@/hooks/use-sns-name", () => ({
  useSnsName: () => ({
    registeredSnsName: null,
    hasRegisteredSnsName: false,
    needsUpdate: false,
    isLoading: false,
    isRegistering: false,
    error: snsError,
    complianceFlags: 0,
    auditorPubkey: null,
    lookupMySnsName: async () => {},
    lookupSnsName: async () => null,
    registerSnsSubdomain,
    updateSnsStealthData: async () => false,
    setComplianceFlag: async () => false,
    setAuditorPubkey: async () => false,
    canRegister: true,
    authorityLabel: "passkey",
  }),
}));

import { ReceiveNamePrompt } from "./receive-name-prompt";

beforeEach(() => {
  localStorage.clear();
  mockedNetwork = "devnet-regtest";
  registerSnsSubdomain = async () => true;
  snsError = null;
});

afterEach(() => {
  cleanup();
});

describe("ReceiveNamePrompt", () => {
  it("opens on Solana networks with SNS configured", async () => {
    render(<ReceiveNamePrompt />);

    await waitFor(() => {
      expect(screen.getByText("Claim your receive name")).toBeTruthy();
    });
    expect(screen.getByText(".utxopia.sol")).toBeTruthy();
  });

  it("does not open on Sui networks", async () => {
    mockedNetwork = "sui-regtest";
    render(<ReceiveNamePrompt />);

    await waitFor(() => {
      expect(screen.queryByText("Claim your receive name")).toBeNull();
    });
  });

  it("keeps the prompt open and shows an error when registration fails", async () => {
    registerSnsSubdomain = async () => false;
    render(<ReceiveNamePrompt />);

    await waitFor(() => {
      expect(screen.getByText("Claim your receive name")).toBeTruthy();
    });

    fireEvent.change(screen.getByPlaceholderText("yourname"), {
      target: { value: "albert" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Register" }));

    await waitFor(() => {
      expect(screen.getByText("Could not claim Solana private name.")).toBeTruthy();
    });
    expect(screen.getByText("Claim your receive name")).toBeTruthy();
  });
});
