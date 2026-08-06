import { Connection, PublicKey } from "@solana/web3.js";
import { Address, OutScript } from "@scure/btc-signer";
import { sha256 } from "@noble/hashes/sha256";
import { deriveExitDestinationPDA } from "@/lib/solana/pdas";

/**
 * The Verified vault's exit registry, read straight from Solana.
 *
 * This is the one status a member should never take the operator's word for:
 * it answers "what can I still withdraw if they are gone", so asking them is
 * circular. Everything here derives the PDA locally and reads the account.
 *
 * The registry is keyed by the *destination*, not by the member —
 * `["exit_destination", pool_state, kind, key]` — which has a consequence worth
 * knowing: you can ask whether a given bitcoin address is registered, but there
 * is no on-chain question of the form "does this member have one". For SPL the
 * key is the owner's own pubkey, so that one is directly answerable.
 */
export const EXIT_KIND_SOLANA_OWNER = 0;
export const EXIT_KIND_BTC_SCRIPT = 1;

export type BtcNetwork = "mainnet" | "testnet" | "regtest";

const BTC_NETWORKS = {
  mainnet: undefined,
  testnet: { bech32: "tb", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
  regtest: { bech32: "bcrt", pubKeyHash: 0x6f, scriptHash: 0xc4, wif: 0xef },
} as const;

export function exitDestinationPda(
  programId: PublicKey,
  poolState: PublicKey,
  kind: number,
  key: Uint8Array,
): PublicKey {
  return deriveExitDestinationPDA(poolState, kind, key, programId)[0];
}

/** `sha256(scriptPubKey)` — scripts are variable length, the key never is. */
export function btcScriptHash(address: string, network: BtcNetwork): Uint8Array {
  const decoded = Address(BTC_NETWORKS[network] as never).decode(address.trim());
  if (!decoded) throw new Error("address does not decode to an output script");
  return sha256(OutScript.encode(decoded));
}

async function isRegistered(
  connection: Connection,
  programId: PublicKey,
  poolState: PublicKey,
  kind: number,
  key: Uint8Array,
): Promise<boolean> {
  const pda = exitDestinationPda(programId, poolState, kind, key);
  const account = await connection.getAccountInfo(pda);
  // An unregistered destination resolves to an address nobody has created.
  return Boolean(account && account.owner.equals(programId) && account.data.length > 0);
}

/** Can this wallet pull SPL assets out with no approval? */
export function hasSolanaExit(
  connection: Connection,
  programId: PublicKey,
  poolState: PublicKey,
  wallet: PublicKey,
): Promise<boolean> {
  return isRegistered(connection, programId, poolState, EXIT_KIND_SOLANA_OWNER, wallet.toBytes());
}

/**
 * Can bitcoin be withdrawn to this address with no approval?
 *
 * Throws on an address that is not valid for the network — which is the point
 * of checking here rather than trusting a stored list: a typo cannot come back
 * clean.
 */
export function hasBtcExit(
  connection: Connection,
  programId: PublicKey,
  poolState: PublicKey,
  address: string,
  network: BtcNetwork,
): Promise<boolean> {
  return isRegistered(
    connection, programId, poolState, EXIT_KIND_BTC_SCRIPT, btcScriptHash(address, network),
  );
}
