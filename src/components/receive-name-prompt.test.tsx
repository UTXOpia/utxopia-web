/** @happy-dom */
import { afterEach, beforeEach, describe, expect, it, mock } from "bun:test";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { getNetworkConfig, type NetworkId } from "@/lib/network-config";

let mockedNetwork: NetworkId = "devnet-regtest";

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
    error: null,
    complianceFlags: 0,
    auditorPubkey: null,
    lookupMySnsName: async () => {},
    lookupSnsName: async () => null,
    registerSnsSubdomain: async () => true,
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
});
