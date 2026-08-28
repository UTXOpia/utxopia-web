import { UTXOpiaClient } from "@utxopia/sdk";
import type { StealthMetaAddress } from "@utxopia/sdk";
import type { NetworkConfig } from "@/lib/network-config";
import { useDepositIndexStore } from "@/stores/deposit-index-store";

/** What the faucet route needs to validate and register a tweak deposit. */
export interface TweakDepositRequest {
  depositAddress: string;
  notePublicKey: string;
  ephemeralPubkey: string;
}

const hex = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");

/**
 * Derive an OP_RETURN-free deposit address for this wallet.
 *
 * Returns `{}` when the network has no Ika dWallet key configured, which leaves
 * the caller on the OP_RETURN path — the route decides which flow it is running,
 * and sending these fields when it is not expecting them is harmless.
 *
 * The index is claimed from persistent storage and never reused. Reusing one
 * re-derives the same address: safe on chain, but it links the two deposits for
 * anyone watching.
 */
export async function deriveTweakDepositForFaucet(
  config: NetworkConfig,
  identity: string,
): Promise<TweakDepositRequest | Record<string, never>> {
  const vaultKeyHex = config?.ika?.dwalletXOnlyPubkey;
  if (!vaultKeyHex || /^0+$/.test(vaultKeyHex)) return {};

  const network =
    config?.bitcoin?.network === "regtest"
      ? "regtest"
      : config?.bitcoin?.network === "mainnet"
        ? "mainnet"
        : "testnet";

  const depositIndex = useDepositIndexStore.getState().claim(identity);
  const deposit = await UTXOpiaClient.instance().prepareTweakDeposit({
    depositIndex,
    ikaXOnlyPubkey: Uint8Array.from(
      vaultKeyHex.match(/../g)!.map((b) => parseInt(b, 16)),
    ),
    network,
  });

  return {
    depositAddress: deposit.btcAddress,
    notePublicKey: hex(deposit.npk),
    ephemeralPubkey: hex(deposit.ephemeralPub),
  };
}

/**
 * Whether this network can credit an OP_RETURN-free deposit.
 *
 * Gated on the Ika key being configured, because the address's tapleaf names it.
 * A network without one has no disc-25 deposit path at all.
 */
export function tweakDepositsEnabled(config: NetworkConfig): boolean {
  const key = config?.ika?.dwalletXOnlyPubkey;
  return Boolean(key) && !/^0+$/.test(key!);
}

/**
 * Derive an OP_RETURN-free deposit for this wallet, in the shape the deposit
 * hooks already consume.
 *
 * `opReturnPayload` is deliberately absent rather than empty: `buildDepositPsbt`
 * adds a data output when it is present, and an empty one would still add it.
 */
export async function prepareTweakDeposit(
  config: NetworkConfig,
  recipient: StealthMetaAddress,
): Promise<{
  btcAddress: string;
  opReturnPayload?: undefined;
  npk: Uint8Array;
  ephemeralPub: Uint8Array;
}> {
  const vaultKeyHex = config?.ika?.dwalletXOnlyPubkey;
  if (!vaultKeyHex) throw new Error("network has no Ika dWallet key configured");

  const network =
    config?.bitcoin?.network === "regtest"
      ? "regtest"
      : config?.bitcoin?.network === "mainnet"
        ? "mainnet"
        : "testnet";

  const identity = bytesToHexLocal(recipient.mpk);
  const depositIndex = useDepositIndexStore.getState().claim(identity);

  const deposit = await UTXOpiaClient.instance().prepareTweakDeposit({
    depositIndex,
    ikaXOnlyPubkey: Uint8Array.from(vaultKeyHex.match(/../g)!.map((b) => parseInt(b, 16))),
    recipient,
    network,
  });

  return {
    btcAddress: deposit.btcAddress,
    npk: deposit.npk,
    ephemeralPub: deposit.ephemeralPub,
  };
}

const bytesToHexLocal = (b: Uint8Array) =>
  Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
