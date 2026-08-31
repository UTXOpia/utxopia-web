import { UTXOpiaClient, decodeStealthMetaAddress } from "@utxopia/sdk";
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
 * Derive a deposit address for this wallet.
 *
 * Throws when the network has no Ika dWallet key: the faucet has no other flow
 * to fall back to, and the route would reject the request anyway with a message
 * about missing fields rather than the actual cause.
 *
 * The index is claimed from persistent storage and never reused. Reusing one
 * re-derives the same address: safe on chain, but it links the two deposits for
 * anyone watching.
 */
export async function deriveTweakDepositForFaucet(
  config: NetworkConfig,
  stealthAddress: string,
): Promise<TweakDepositRequest> {
  const vaultKeyHex = config?.ika?.dwalletXOnlyPubkey;
  if (!vaultKeyHex || /^0+$/.test(vaultKeyHex)) {
    throw new Error("this network has no Ika dWallet key configured — no deposit address can be derived");
  }

  const network =
    config?.bitcoin?.network === "regtest"
      ? "regtest"
      : config?.bitcoin?.network === "mainnet"
        ? "mainnet"
        : "testnet";

  const depositIndex = claimDepositIndex(stealthAddress);
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

/** Derive a deposit for this wallet, in the shape the deposit hooks consume. */
export async function prepareTweakDeposit(
  config: NetworkConfig,
  recipient: StealthMetaAddress,
): Promise<{
  btcAddress: string;
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

  const depositIndex = useDepositIndexStore.getState().claim(bytesToHexLocal(recipient.mpk));

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

/**
 * Claim the next deposit index for the wallet behind an encoded meta-address.
 *
 * Keyed by mpk, the same key the recipient-passing path uses. They used to
 * disagree — this one keyed on the encoded address — which gave one wallet two
 * counters both starting at 0, so its first faucet deposit and its first wallet
 * deposit derived the same address and linked themselves to each other. The
 * legacy counter is carried forward so an existing wallet does not restart.
 */
export function claimDepositIndex(stealthAddress: string): number {
  const identity = bytesToHexLocal(decodeStealthMetaAddress(stealthAddress).mpk);
  const store = useDepositIndexStore.getState();
  const legacy = store.peek(stealthAddress);
  if (legacy > 0) store.observe(identity, legacy - 1);
  return useDepositIndexStore.getState().claim(identity);
}
