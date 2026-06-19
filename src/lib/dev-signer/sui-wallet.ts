import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient } from "@/lib/sui/client";
import type { SuiTxWallet } from "@/lib/sui/client";
import type { NetworkId } from "@/lib/network-config";

/**
 * Installs the dev `window.suiWallet` shim and returns the dev wallet's Sui
 * address. Implements both the tx-signing seam (`signAndExecuteTransactionBlock`,
 * used by the shield PTB path) and the connect seam the SuiAuthPanel uses
 * (`requestPermissions` / `getAccounts` / `signPersonalMessage`) so the
 * "Connect Sui wallet" button works headlessly too.
 */
export function installSuiWalletShim(suiSecretKey: string, networkId: NetworkId): string {
  const keypair = Ed25519Keypair.fromSecretKey(suiSecretKey);
  const address = keypair.toSuiAddress();
  const client = getSuiClient(networkId);

  const shim: SuiTxWallet & {
    requestPermissions: () => Promise<boolean>;
    getAccounts: () => Promise<string[]>;
    signPersonalMessage: (input: { message: Uint8Array }) => Promise<{ signature: string }>;
  } = {
    async signAndExecuteTransactionBlock(input: {
      transactionBlock: unknown;
      options?: { showEffects?: boolean };
    }) {
      const tx = input.transactionBlock as Transaction;
      tx.setSenderIfNotSet(address);
      const result = await client.signAndExecuteTransaction({
        signer: keypair,
        transaction: tx,
        options: { showEffects: true },
      });
      return {
        digest: result.digest,
        effects: result.effects
          ? {
              status: result.effects.status
                ? { status: result.effects.status.status, error: result.effects.status.error }
                : undefined,
            }
          : undefined,
      };
    },
    async requestPermissions() {
      return true;
    },
    async getAccounts() {
      return [address];
    },
    async signPersonalMessage(input: { message: Uint8Array }) {
      const { signature } = await keypair.signPersonalMessage(input.message);
      return { signature };
    },
  };

  (window as unknown as { suiWallet: typeof shim }).suiWallet = shim;
  return address;
}
