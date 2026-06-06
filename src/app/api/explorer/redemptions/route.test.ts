import { beforeEach, describe, expect, it, mock } from "bun:test";

const fetchSuiExplorerTransactions = mock(async () => [
  {
    txSignature: "sui-request-digest",
    type: "withdraw",
    tokenId: "zkbtc",
    tokenSymbol: "BTC",
    timestamp: 1_760_000_000_000,
    status: "processing",
    inputs: [{ requestId: "redeem-pending", grossAmount: 100_000, fee: 2_000 }],
    outputs: [{
      type: "withdraw",
      amount: 100_000,
      fee: 2_000,
      payout: 98_000,
      requestId: "redeem-pending",
      btcScript: "0014pending",
      btcTxid: undefined,
      localStatus: "Processing",
    }],
  },
  {
    txSignature: "sui-complete-digest",
    type: "withdraw",
    tokenId: "zkbtc",
    tokenSymbol: "BTC",
    timestamp: 1_760_000_010_000,
    status: "confirmed",
    inputs: [{ requestId: "redeem-complete", grossAmount: 200_000, fee: 3_000 }],
    outputs: [{
      type: "withdraw",
      amount: 200_000,
      fee: 3_000,
      payout: 197_000,
      requestId: "redeem-complete",
      btcScript: "0014complete",
      btcTxid: "btc-txid",
      localStatus: "Completed",
    }],
  },
  {
    txSignature: "sui-transfer-digest",
    type: "transfer",
    tokenId: "zkbtc",
    tokenSymbol: "BTC",
    timestamp: 1_760_000_020_000,
    status: "confirmed",
    inputs: [],
    outputs: [],
  },
]);

mock.module("@/lib/sui/explorer", () => ({
  fetchSuiExplorerTransactions,
}));

const { GET } = await import("./route");

describe("/api/explorer/redemptions", () => {
  beforeEach(() => {
    fetchSuiExplorerTransactions.mockClear();
  });

  it("maps Sui withdraw explorer transactions to redemption rows", async () => {
    const response = await GET(new Request("https://app.utxopia.test/api/explorer/redemptions?network=sui-regtest") as any);
    const json = await response.json();

    expect(response.status).toBe(200);
    expect(fetchSuiExplorerTransactions).toHaveBeenCalledTimes(1);
    expect(json.count).toBe(2);
    expect(json.redemptions).toEqual([
      {
        pubkey: "redeem-pending",
        requestId: "redeem-pending",
        amountSats: "100000",
        status: "Processing",
        requester: "",
        btcScript: "0014pending",
        btcTxid: null,
        localStatus: "Processing",
        createdAt: 1_760_000_000_000,
        updatedAt: 1_760_000_000_000,
        retryCount: 0,
        trackerError: null,
        actualReceived: null,
        requestTxSignature: "sui-request-digest",
        processingTxSignature: "sui-request-digest",
        completeTxSignature: null,
        simulated: false,
        serviceFee: "2000",
        serviceFeeBps: 0,
        serviceFeeBase: 0,
        burnAmount: "100000",
        protocolRevenue: "2000",
        inputCount: 1,
        outputCount: 1,
      },
      {
        pubkey: "redeem-complete",
        requestId: "redeem-complete",
        amountSats: "200000",
        status: "Completed",
        requester: "",
        btcScript: "0014complete",
        btcTxid: "btc-txid",
        localStatus: "Completed",
        createdAt: 1_760_000_010_000,
        updatedAt: 1_760_000_010_000,
        retryCount: 0,
        trackerError: null,
        actualReceived: "197000",
        requestTxSignature: "sui-complete-digest",
        processingTxSignature: null,
        completeTxSignature: "sui-complete-digest",
        simulated: false,
        serviceFee: "3000",
        serviceFeeBps: 0,
        serviceFeeBase: 0,
        burnAmount: "200000",
        protocolRevenue: "3000",
        inputCount: 1,
        outputCount: 1,
      },
    ]);
  });
});
