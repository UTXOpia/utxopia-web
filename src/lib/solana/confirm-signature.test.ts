import { describe, expect, it, mock } from "bun:test";
import { confirmSubmittedSignature } from "./confirm-signature";

describe("confirmSubmittedSignature", () => {
  it("accepts a signature once RPC reports it confirmed", async () => {
    const getSignatureStatuses = mock()
      .mockResolvedValueOnce({ value: [null] })
      .mockResolvedValueOnce({ value: [{ err: null, confirmationStatus: "confirmed", confirmations: 1 }] });

    await confirmSubmittedSignature(
      { getSignatureStatuses } as never,
      "confirmed-signature",
      { timeoutMs: 100, pollIntervalMs: 0 },
    );

    expect(getSignatureStatuses).toHaveBeenCalledTimes(2);
  });

  it("surfaces an on-chain transaction error", async () => {
    const getSignatureStatuses = mock().mockResolvedValue({
      value: [{ err: { InstructionError: [0, "Custom"] }, confirmationStatus: "confirmed", confirmations: 1 }],
    });

    expect(confirmSubmittedSignature(
      { getSignatureStatuses } as never,
      "failed-signature",
      { timeoutMs: 100, pollIntervalMs: 0 },
    )).rejects.toThrow("Transaction failed");
  });
});
