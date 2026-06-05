import { existsSync, readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";

export function getSuiRelayerKeypair(): Ed25519Keypair {
  const privateKey = process.env.UTXOPIA_SUI_RELAYER_PRIVATE_KEY
    ?? process.env.UTXOPIA_SUI_PRIVATE_KEY;
  if (privateKey) {
    return Ed25519Keypair.fromSecretKey(privateKey);
  }

  const rawKeypair = process.env.UTXOPIA_SUI_RELAYER_KEYPAIR;
  if (rawKeypair) {
    const parsed = JSON.parse(rawKeypair) as number[] | string;
    if (typeof parsed === "string") {
      const decoded = Uint8Array.from(Buffer.from(parsed, "base64"));
      return Ed25519Keypair.fromSecretKey(decoded[0] === 0 ? decoded.slice(1) : decoded);
    }
    return Ed25519Keypair.fromSecretKey(Uint8Array.from(parsed));
  }

  const activeAddress = process.env.UTXOPIA_SUI_RELAYER_ADDRESS;
  const keypairPath = process.env.UTXOPIA_SUI_RELAYER_KEYPAIR_PATH
    ?? process.env.UTXOPIA_SUI_KEYPAIR_PATH
    ?? path.join(os.homedir(), ".sui/sui_config/sui.keystore");
  if (!existsSync(keypairPath)) {
    throw new Error("Sui relayer key is not configured");
  }

  const entries = JSON.parse(readFileSync(keypairPath, "utf8")) as string[];
  for (const encoded of entries) {
    const decoded = Uint8Array.from(Buffer.from(encoded, "base64"));
    if (decoded[0] !== 0) continue;
    const keypair = Ed25519Keypair.fromSecretKey(decoded.slice(1));
    if (!activeAddress || keypair.toSuiAddress() === activeAddress) {
      return keypair;
    }
  }

  throw new Error(activeAddress
    ? `No Ed25519 key for Sui relayer address ${activeAddress}`
    : "No Ed25519 Sui relayer key found");
}

export async function executeSuiTransactionKind(input: {
  rpcUrl: string;
  bytes: Uint8Array;
  gasBudget?: bigint;
}) {
  const client = new SuiJsonRpcClient({ url: input.rpcUrl, network: "testnet" });
  const signer = getSuiRelayerKeypair();
  const tx = Transaction.fromKind(input.bytes);
  tx.setSender(signer.toSuiAddress());
  tx.setGasBudget(input.gasBudget ?? BigInt(process.env.UTXOPIA_SUI_GAS_BUDGET ?? "100000000"));

  const result = await client.signAndExecuteTransaction({
    signer,
    transaction: tx,
    options: {
      showEffects: true,
      showEvents: true,
      showObjectChanges: true,
    },
  });

  await client.waitForTransaction({
    digest: result.digest,
    options: { showEffects: true },
  });

  return result;
}
