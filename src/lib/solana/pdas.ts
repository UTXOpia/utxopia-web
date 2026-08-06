/**
 * Solana PDA Derivation & Config Helpers (web3.js)
 *
 * An adapter, not a second implementation. Every seed array comes from
 * `@utxopia/sdk`, which mirrors the on-chain program; this file only turns those
 * seeds into `@solana/web3.js` `PublicKey`s synchronously, because the SDK's own
 * derivations are async (`getProgramDerivedAddress`) and the wallet adapter path
 * needs sync `PublicKey`s.
 *
 * Do not write a seed literal here. This file used to restate the seeds itself
 * and drifted from the program twice — the nullifier record and the redemption
 * request each lost their pool scope, and each failed only on chain, after a
 * proof had already been generated and paid for.
 *
 * @module solana/pdas
 */

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  getConfig,
  blockHeaderSeeds,
  commitmentTreeSeeds,
  depositReceiptSeeds,
  exitDestinationSeeds,
  heightIndexSeeds,
  lightClientSeeds,
  nullifierRecordSeeds,
  poolConfigSeeds,
  poolStateSeeds,
  redemptionRequestSeeds,
  tokenConfigSeeds,
  verifiedTransactionSeeds,
  vkRegistrySeeds,
  EXIT_KIND_SOLANA_OWNER,
  EXIT_KIND_BTC_SCRIPT,
} from "@utxopia/sdk";

export { EXIT_KIND_SOLANA_OWNER, EXIT_KIND_BTC_SCRIPT };

// =============================================================================
// Program IDs as web3.js PublicKeys (lazy, from SDK config)
// =============================================================================

export function getUTXOpiaProgramId(): PublicKey {
  return new PublicKey(getConfig().utxopiaProgramId);
}

export function getBtcLightClientProgramId(): PublicKey {
  return new PublicKey(getConfig().btcLightClientProgramId);
}

export function getTokenProgramId(): PublicKey {
  return new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
}

export function getToken2022ProgramId(): PublicKey {
  return new PublicKey(getConfig().token2022ProgramId);
}

/** Get the token program that owns a mint (Token Program or Token-2022) */
export async function getTokenProgramForMint(
  connection: import("@solana/web3.js").Connection,
  mint: PublicKey
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mint);
  if (!info) throw new Error(`Mint account not found: ${mint.toBase58()}`);
  return info.owner;
}

export function getZkbtcMint(): PublicKey {
  return new PublicKey(getConfig().zkbtcMint);
}

export function getChadbufferProgramId(): PublicKey {
  return new PublicKey(getConfig().chadbufferProgramId);
}

// =============================================================================
// PDA Derivation (sync, over the SDK's seed builders)
//
// Every default below resolves through the SDK config, and `initConfig` is only
// ever called from the browser (chain-environment.ts). Server code that takes
// the defaults therefore derives against the SDK's built-in mint — a pool that
// was never deployed — and the program rejects the resulting accounts as
// system-owned. In an API route, always pass `poolId`/`poolState` explicitly
// from the resolved network config. On a dual-vault network the same applies to
// client code: the default is whichever vault the SDK saw last.
// =============================================================================

/** Turn SDK seed bytes into a web3.js PDA. The one place address math happens. */
function pda(seeds: Uint8Array[], programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    seeds.map((seed) => Buffer.from(seed)),
    programId,
  );
}

export function derivePoolStatePDA(
  programId: PublicKey = getUTXOpiaProgramId(),
  poolId: PublicKey = getZkbtcMint(),
): [PublicKey, number] {
  return pda(poolStateSeeds(poolId.toBytes()), programId);
}

export function deriveCommitmentTreePDA(
  programId: PublicKey = getUTXOpiaProgramId(),
  treeIndex = 0,
  poolState: PublicKey = derivePoolStatePDA(programId)[0],
): [PublicKey, number] {
  return pda(commitmentTreeSeeds(poolState.toBytes(), treeIndex), programId);
}

export function deriveNullifierPDA(
  nullifierHash: Uint8Array,
  poolState: PublicKey,
  treeIndex = 0,
  programId: PublicKey = getUTXOpiaProgramId()
): [PublicKey, number] {
  return pda(nullifierRecordSeeds(nullifierHash, poolState.toBytes(), treeIndex), programId);
}

export function deriveLightClientPDA(
  programId: PublicKey = getBtcLightClientProgramId()
): [PublicKey, number] {
  return pda(lightClientSeeds(), programId);
}

export function deriveBlockHeaderPDA(
  blockHash: Uint8Array,
  programId: PublicKey = getBtcLightClientProgramId()
): [PublicKey, number] {
  return pda(blockHeaderSeeds(blockHash), programId);
}

export function deriveHeightIndexPDA(
  height: number | bigint,
  programId: PublicKey = getBtcLightClientProgramId()
): [PublicKey, number] {
  return pda(heightIndexSeeds(height), programId);
}

export function deriveVkRegistryPDA(
  nInputs: number,
  nOutputs: number,
  programId: PublicKey = getUTXOpiaProgramId()
): [PublicKey, number] {
  return pda(vkRegistrySeeds(nInputs, nOutputs), programId);
}

export function deriveRedemptionRequestPDA(
  userPubkey: PublicKey,
  nonce: bigint,
  programId: PublicKey = getUTXOpiaProgramId(),
  poolState: PublicKey = derivePoolStatePDA(programId)[0],
): [PublicKey, number] {
  return pda(redemptionRequestSeeds(poolState.toBytes(), userPubkey.toBytes(), nonce), programId);
}

export function deriveVerifiedTransactionPDA(
  blockHash: Uint8Array,
  txid: Uint8Array,
  programId: PublicKey = getBtcLightClientProgramId()
): [PublicKey, number] {
  return pda(verifiedTransactionSeeds(blockHash, txid), programId);
}

/** Omit `depositVout` for the active `complete_deposit` flow; pass it for the
 *  OP_RETURN-free `verify_deposit` flow, which keys one receipt per output. */
export function deriveDepositReceiptPDA(
  depositTxid: Uint8Array,
  programId: PublicKey = getUTXOpiaProgramId(),
  depositVout?: number,
): [PublicKey, number] {
  return pda(depositReceiptSeeds(depositTxid, depositVout), programId);
}

export function deriveTokenConfigPDA(
  mint: PublicKey,
  programId: PublicKey = getUTXOpiaProgramId(),
  poolState: PublicKey = derivePoolStatePDA(programId)[0],
): [PublicKey, number] {
  return pda(tokenConfigSeeds(poolState.toBytes(), mint.toBytes()), programId);
}

export function derivePoolConfigPDA(
  programId: PublicKey = getUTXOpiaProgramId(),
  poolState: PublicKey = derivePoolStatePDA(programId)[0],
): [PublicKey, number] {
  return pda(poolConfigSeeds(poolState.toBytes()), programId);
}

/** `key` is the recipient token account's OWNER for EXIT_KIND_SOLANA_OWNER, or
 *  `sha256(btcScript)` for EXIT_KIND_BTC_SCRIPT. The kind is a seed, so an owner
 *  and a script hash sharing 32 bytes stay distinct. */
export function deriveExitDestinationPDA(
  poolState: PublicKey,
  kind: number,
  key: Uint8Array,
  programId: PublicKey = getUTXOpiaProgramId(),
): [PublicKey, number] {
  return pda(exitDestinationSeeds(poolState.toBytes(), kind, key), programId);
}

// =============================================================================
// Associated token accounts
//
// Plain SPL derivations, not UTXOpia PDAs — no program seeds involved, so they
// stay here rather than in the SDK.
// =============================================================================

export function derivePoolVaultATA(
  programId: PublicKey = getUTXOpiaProgramId(),
  mint: PublicKey = getZkbtcMint(),
  tokenProgramId: PublicKey = getToken2022ProgramId(),
  poolState: PublicKey = derivePoolStatePDA(programId)[0],
): PublicKey {
  return getAssociatedTokenAddressSync(
    mint,
    poolState,
    true,
    tokenProgramId,
  );
}

export function getTokenAccountAddress(userPubkey: PublicKey): PublicKey {
  return getAssociatedTokenAddressSync(
    getZkbtcMint(),
    userPubkey,
    false,
    getToken2022ProgramId()
  );
}
