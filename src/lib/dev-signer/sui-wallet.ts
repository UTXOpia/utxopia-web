import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { getSuiClient } from "@/lib/sui/client";
import type { SuiTxWallet } from "@/lib/sui/client";
import type { NetworkId } from "@/lib/network-config";

export function installSuiWalletShim(suiSecretKey: string, networkId: NetworkId): void {
  const keypair = Ed25519Keypair.fromSecretKey(suiSecretKey);
  const address = keypair.toSuiAddress();
  const client = getSuiClient(networkId);

  const shim: SuiTxWallet = {
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
  };

  (window as unknown as { suiWallet: SuiTxWallet }).suiWallet = shim;
}
