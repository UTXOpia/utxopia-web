/**
 * Solana PDA Derivation & Config Helpers (web3.js)
 *
 * Thin wrapper that provides @solana/web3.js PublicKey constants and
 * synchronous PDA derivation using seed constants from @utxopia/sdk.
 *
 * All instruction data building lives in @utxopia/sdk — this file only
 * bridges SDK config → web3.js types for wallet-adapter compatibility.
 *
 * @module solana/pdas
 */

import { PublicKey } from "@solana/web3.js";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { getConfig, PDA_SEEDS } from "@utxopia/sdk";

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
// PDA Derivation (sync, using PDA_SEEDS from SDK)
//
// Every default below resolves through the SDK config, and `initConfig` is only
// ever called from the browser (chain-environment.ts). Server code that takes
// the defaults therefore derives against the SDK's built-in mint — a pool that
// was never deployed — and the program rejects the resulting accounts as
// system-owned. In an API route, always pass `poolId`/`poolState` explicitly
// from the resolved network config. On a dual-vault network the same applies to
// client code: the default is whichever vault the SDK saw last.
// =============================================================================

export function derivePoolStatePDA(
  programId: PublicKey = getUTXOpiaProgramId(),
  poolId: PublicKey = getZkbtcMint(),
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.POOL_STATE), poolId.toBuffer()],
    programId
  );
}

export function deriveCommitmentTreePDA(
  programId: PublicKey = getUTXOpiaProgramId(),
  treeIndex = 0,
  poolState: PublicKey = derivePoolStatePDA(programId)[0],
): [PublicKey, number] {
  const idx = Buffer.alloc(4);
  idx.writeUInt32LE(treeIndex, 0);
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.COMMITMENT_TREE), poolState.toBuffer(), idx],
    programId
  );
}

/**
 * Seeds are ["nullifier", pool_state, nullifier] on tree 0, and
 * ["nullifier", pool_state, tree_index_le, nullifier] after a rotation.
 *
 * A nullifier is Poseidon(nullifyingKey, leafIndex), so it names a note only
 * within one pool and one tree — leaf indices restart at 0 in each new tree.
 * Drop either scope and two distinct notes collapse onto one PDA, where
 * spending either strands the other. Tree 0 keeps the shorter seeds so records
 * already on chain stay reachable.
 */
export function deriveNullifierPDA(
  nullifierHash: Uint8Array,
  poolState: PublicKey,
  treeIndex = 0,
  programId: PublicKey = getUTXOpiaProgramId()
): [PublicKey, number] {
  const seeds: Buffer[] = [Buffer.from(PDA_SEEDS.NULLIFIER), poolState.toBuffer()];
  if (treeIndex !== 0) {
    const idx = Buffer.alloc(4);
    idx.writeUInt32LE(treeIndex);
    seeds.push(idx);
  }
  seeds.push(Buffer.from(nullifierHash));
  return PublicKey.findProgramAddressSync(seeds, programId);
}

export function deriveLightClientPDA(
  programId: PublicKey = getBtcLightClientProgramId()
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.LIGHT_CLIENT)],
    programId
  );
}

export function deriveBlockHeaderPDA(
  blockHash: Uint8Array,
  programId: PublicKey = getBtcLightClientProgramId()
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.BLOCK_HEADER), blockHash],
    programId
  );
}

export function deriveVkRegistryPDA(
  nInputs: number,
  nOutputs: number,
  programId: PublicKey = getUTXOpiaProgramId()
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.VK_REGISTRY), new Uint8Array([nInputs]), new Uint8Array([nOutputs])],
    programId
  );
}

/** Pool-scoped, matching `redeem.rs`:
 *  `["redemption", pool_state, user, nonce_le]`. The pool seed was added on
 *  chain and in the SDK but not here, so this helper derived an address the
 *  program rejects with InvalidSeeds ("Provided seeds do not result in a valid
 *  address") — after the proof had already verified, which made it read like a
 *  proof problem. Same omission the nullifier PDA had. */
export function deriveRedemptionRequestPDA(
  userPubkey: PublicKey,
  nonce: bigint,
  programId: PublicKey = getUTXOpiaProgramId(),
  poolState: PublicKey = derivePoolStatePDA(programId)[0],
): [PublicKey, number] {
  const nonceBytes = new Uint8Array(8);
  new DataView(nonceBytes.buffer).setBigUint64(0, nonce, true);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("redemption"), poolState.toBuffer(), userPubkey.toBytes(), nonceBytes],
    programId
  );
}

export function deriveVerifiedTransactionPDA(
  blockHash: Uint8Array,
  txid: Uint8Array,
  programId: PublicKey = getBtcLightClientProgramId()
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("verified_tx"), Buffer.from(blockHash), Buffer.from(txid)],
    programId
  );
}

export function deriveDepositReceiptPDA(
  depositTxid: Uint8Array,
  programId: PublicKey = getUTXOpiaProgramId()
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("deposit_receipt"), Buffer.from(depositTxid)],
    programId
  );
}

export function deriveTokenConfigPDA(
  mint: PublicKey,
  programId: PublicKey = getUTXOpiaProgramId(),
  poolState: PublicKey = derivePoolStatePDA(programId)[0],
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(PDA_SEEDS.TOKEN_CONFIG), poolState.toBuffer(), mint.toBuffer()],
    programId
  );
}

export function derivePoolConfigPDA(
  programId: PublicKey = getUTXOpiaProgramId(),
  poolState: PublicKey = derivePoolStatePDA(programId)[0],
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("pool_config"), poolState.toBuffer()],
    programId
  );
}

// =============================================================================
// Utility
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
