// web/src/lib/dev-signer/enabled.ts
/** Dev signer is opt-in: the flag must be the exact string "1". */
export function isDevSignerEnabled(): boolean {
  return process.env.NEXT_PUBLIC_DEV_SIGNER === "1";
}

/** Refuse to run the dev signer against any mainnet network. Throws on load. */
export function assertDevSignerSafe(networkId: string): void {
  if (networkId.includes("mainnet")) {
    throw new Error(
      `[dev-signer] REFUSING to run on mainnet network "${networkId}". ` +
        `Unset NEXT_PUBLIC_DEV_SIGNER.`,
    );
  }
}
