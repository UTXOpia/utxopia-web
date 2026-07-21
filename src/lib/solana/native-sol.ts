export const NATIVE_SOL_MINT = "So11111111111111111111111111111111111111112";
export const NATIVE_SOL_2022_MINT = "9pan9bMn5HatX4EJdBwg9VgCa7Uz5HL8N1m5D3NdXejP";

export function isNativeSolMint(mint: string): boolean {
  return mint === NATIVE_SOL_MINT || mint === NATIVE_SOL_2022_MINT;
}
