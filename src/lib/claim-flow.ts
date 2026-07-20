export function selectUnspentClaimNote<T extends { isSpent: boolean }>(notes: T[]): T {
  const note = notes.find((item) => !item.isSpent);
  if (!note) {
    throw new Error(notes.length > 0
      ? "This claim link has already been redeemed."
      : "No private note was found for this claim link.");
  }
  return note;
}

export function calculateClaimReceiveAmount(
  amountBaseUnits: number | bigint,
  relayFeeBaseUnits: number,
): bigint {
  const fee = BigInt(Math.max(0, Math.floor(relayFeeBaseUnits)));
  const receiveAmount = BigInt(amountBaseUnits) - fee;
  if (receiveAmount <= 0n) {
    throw new Error("This note is too small to cover the relay fee.");
  }
  return receiveAmount;
}
