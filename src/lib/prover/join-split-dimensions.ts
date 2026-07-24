export interface JoinSplitDimensions {
  nInputs: number;
  nOutputs: number;
}

/**
 * Predict the circuit variant before the full proof inputs are assembled.
 * Every flow has one recipient/public output, optionally one relayer-fee
 * output, and optionally one change output.
 */
export function estimateJoinSplitDimensions(
  selectedAmounts: readonly bigint[],
  amount: bigint,
  relayerFee: bigint,
): JoinSplitDimensions | null {
  if (selectedAmounts.length === 0 || amount <= 0n || relayerFee < 0n) {
    return null;
  }

  const totalInput = selectedAmounts.reduce((sum, value) => sum + value, 0n);
  const required = amount + relayerFee;
  if (totalInput < required) return null;

  return {
    nInputs: selectedAmounts.length,
    nOutputs: 1 + (relayerFee > 0n ? 1 : 0) + (totalInput > required ? 1 : 0),
  };
}
