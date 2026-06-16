import { isDevSignerEnabled } from "./enabled";
import { loadDevKeys } from "./keys";
import { DevSolanaWalletAdapter } from "./solana-adapter";
export { isDevSignerEnabled } from "./enabled";
export { DevSigner } from "./DevSigner";

/** Wallet-adapter entries to merge into the WalletProvider list (empty unless enabled). */
export function devSolanaAdapters(): DevSolanaWalletAdapter[] {
  if (!isDevSignerEnabled()) return [];
  const keys = loadDevKeys();
  return keys ? [new DevSolanaWalletAdapter(keys.solanaSecretKeyB58)] : [];
}
