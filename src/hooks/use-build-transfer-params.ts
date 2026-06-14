"use client";

/**
 * buildTransferParams — pure function that translates user inputs into JoinSplitProofInputs.
 *
 * Single source of truth for all 3 simplified flows (transfer, unshield, withdraw).
 * Extracted from pay-flow.tsx to prevent logic drift between flows.
 */

import { toHex64 } from "@/lib/utils/hex";
import { PublicKey } from "@solana/web3.js";
import type { InboxNote } from "@/hooks/use-utxopia";
import type { JoinSplitProofInputs, UTXOpiaKeys, StealthMetaAddress, ScannedNote } from "@utxopia/sdk";
import { reduceToFieldOnChain } from "@/components/send/_lifted/helpers";

export type TransferMode = "stealth" | "public" | "btc";

export interface TransferUserInputs {
  mode: TransferMode;
  amountSats: bigint;
  /** Selected notes from inbox */
  selectedNotes: InboxNote[];
  /** User's utxopia keys */
  keys: UTXOpiaKeys;
  /** User's stealth meta address (for change output) */
  selfMeta: StealthMetaAddress;
  /** Relayer stealth meta (for fee output) */
  relayerMeta?: StealthMetaAddress;
  relayerFee: number;
  /** Chain id folded into bound params (Solana 103, Sui 784). */
  boundChainId: bigint;
  /** Source token mint. Omit/empty for zkBTC (resolves to config.zkbtcMint);
   *  for an SPL cash-out, the underlying mint. Drives the proof token_id and,
   *  for unshield, the recipient ATA + pool vault on the relay. */
  tokenMint?: string;
  /** Mode-specific recipient */
  recipient: {
    stealthMeta?: StealthMetaAddress; // stealth mode
    solanaAddress?: string;           // public/unshield mode
    btcScriptPubKey?: Uint8Array;     // btc withdraw mode
  };
  /**
   * Redeem (btc) only: 32-byte pubkey of the on-chain redeem signer (the relayer that becomes
   * RedemptionRequest.requester). Bound into the redeem proof so it cannot be replayed under a
   * different signer. REQUIRED for mode === "btc".
   */
  requesterPubkey?: Uint8Array;
}

export interface TransferParams {
  proofInputs: JoinSplitProofInputs;
  /** Stealth data arrays for relay submission (72 bytes each) */
  stealthDataArrays: Uint8Array[];
  /** Mode-specific relay submission config */
  relayMode: "transfer" | "unshield" | "redeem";
  /** For unshield: recipient address bytes */
  unshieldRecipientAddress?: Uint8Array;
  /** For unshield: the token mint being cashed out (relay derives ATA/vault/program). */
  unshieldMint?: string;
  /** For redeem: BTC script pubkey */
  btcScriptPubKey?: Uint8Array;
  /** Relayer fee output index (for transfer mode) */
  relayerFeeOutputIndex?: number;
  /** Change amount in sats */
  changeSats: number;
}

export async function buildTransferParams(inputs: TransferUserInputs): Promise<TransferParams> {
  const {
    initPoseidon,
    prepareClaimInputs,
    parseMerkleProofResponse,
    computeJoinSplitCommitmentSync,
    createStealthDepositWithKeys,
    computeBoundParamsHash,
    createUnshieldBoundParams,
    createRedeemBoundParams,
    createTransferBoundParams,
    computeStealthDataHash,
    decodeStealthMetaAddress,
    UTXOpiaClient,
    bytesToHex,
  } = await import("@utxopia/sdk");

  await initPoseidon();

  const { mode, amountSats, selectedNotes, keys, selfMeta, relayerMeta, relayerFee, recipient, boundChainId } = inputs;

  // 1. Fetch merkle proofs and prepare claim inputs for each note
  const utxopiaClient = UTXOpiaClient.isInitialized
    ? UTXOpiaClient.instance()
    : await UTXOpiaClient.init();

  // Token being transacted. Defaults to zkBTC (config.zkbtcMint) so existing
  // zkBTC transfer/redeem/cash-out produce byte-identical proofs; for an SPL
  // cash-out the caller passes that token's mint. getTokenId is the same
  // derivation the notes were scanned with, so inputs/outputs/proof all agree.
  const tokenMintAddress = inputs.tokenMint || utxopiaClient.config.zkbtcMint;
  const tokenId = utxopiaClient.getTokenId(tokenMintAddress);

  const merkleProofs = await utxopiaClient.fetchMerkleProofs(
    selectedNotes.map((n) => n.commitmentHex),
  );

  if (merkleProofs.length !== selectedNotes.length) {
    throw new Error(`Merkle proof count mismatch: got ${merkleProofs.length}, expected ${selectedNotes.length}`);
  }

  const inputsData = await Promise.all(
    selectedNotes.map(async (note, i) => {
      const scannedNote: ScannedNote = {
        amount: typeof note.amount === "bigint" ? note.amount : BigInt(note.amount || 0),
        ephemeralPub: note.ephemeralPub,
        stealthPub: {
          x: typeof note.stealthPub?.x === "bigint" ? note.stealthPub.x : BigInt(note.stealthPub?.x || 0),
          y: typeof note.stealthPub?.y === "bigint" ? note.stealthPub.y : BigInt(note.stealthPub?.y || 0),
        },
        leafIndex: note.leafIndex,
        commitment: note.commitment,
      };

      const merkle = {
        success: true,
        root: toHex64(merkleProofs[i].root),
        siblings: merkleProofs[i].pathElements.map((e) => toHex64(e)),
        indices: merkleProofs[i].pathIndices,
      };

      const realMerkleProof = parseMerkleProofResponse(merkle);
      const claimInputs = await prepareClaimInputs(keys, scannedNote, realMerkleProof);

      return {
        note: { commitmentHex: note.commitmentHex, leafIndex: note.leafIndex, amount: scannedNote.amount },
        claimInputs,
      };
    }),
  );

  // 2. Build outputs
  const sendAmounts: bigint[] = [amountSats];
  const recipientNpks: bigint[] = [];
  const stealthResults: Awaited<ReturnType<typeof createStealthDepositWithKeys>>[] = [];
  const isSpecialOutput = mode === "public" || mode === "btc";

  if (mode === "btc") {
    const result = await createStealthDepositWithKeys(selfMeta, amountSats, tokenId);
    recipientNpks.push(result.stealthPubKeyX);
    stealthResults.push({
      ephemeralPub: new Uint8Array(32),
      encryptedAmount: new Uint8Array(8),
      commitment: result.commitment,
      stealthPubKeyX: result.stealthPubKeyX,
      npkBytes: result.npkBytes,
    });
  } else if (mode === "public") {
    const addrBytes = new PublicKey(recipient.solanaAddress!).toBytes();
    const addrReduced = reduceToFieldOnChain(addrBytes);
    recipientNpks.push(addrReduced);
    stealthResults.push({
      ephemeralPub: new Uint8Array(32),
      encryptedAmount: new Uint8Array(8),
      commitment: new Uint8Array(32),
      stealthPubKeyX: addrReduced,
      npkBytes: new Uint8Array(32),
    });
  } else {
    // stealth transfer
    const result = await createStealthDepositWithKeys(recipient.stealthMeta!, amountSats, tokenId);
    recipientNpks.push(result.stealthPubKeyX);
    stealthResults.push(result);
  }

  // 3. Add relayer fee output (before special output if applicable)
  let relayerFeeOutputIndex: number | undefined;
  if (relayerFee > 0) {
    const feeAmount = BigInt(relayerFee);
    const feeMeta = relayerMeta || selfMeta;
    const feeResult = await createStealthDepositWithKeys(feeMeta, feeAmount, tokenId);

    if (isSpecialOutput) {
      const insertIdx = sendAmounts.length - 1;
      relayerFeeOutputIndex = insertIdx;
      sendAmounts.splice(insertIdx, 0, feeAmount);
      recipientNpks.splice(insertIdx, 0, feeResult.stealthPubKeyX);
      stealthResults.splice(insertIdx, 0, feeResult);
    } else {
      relayerFeeOutputIndex = sendAmounts.length;
      sendAmounts.push(feeAmount);
      recipientNpks.push(feeResult.stealthPubKeyX);
      stealthResults.push(feeResult);
    }
  }

  // 4. Add change output (use bigint to avoid precision loss)
  const totalInput = inputsData.reduce((sum, d) => sum + d.note.amount, 0n);
  const totalOutput = sendAmounts.reduce((sum, a) => sum + a, 0n);
  if (totalOutput > totalInput) {
    throw new Error(
      `Insufficient shielded balance: selected notes total ${totalInput} sats, outputs require ${totalOutput} sats`,
    );
  }
  const changeSats = Number(totalInput - totalOutput);

  if (changeSats > 0) {
    const changeAmount = BigInt(changeSats);
    const changeResult = await createStealthDepositWithKeys(selfMeta, changeAmount, tokenId);

    if (isSpecialOutput) {
      const insertIdx = sendAmounts.length - 1;
      sendAmounts.splice(insertIdx, 0, changeAmount);
      recipientNpks.splice(insertIdx, 0, changeResult.stealthPubKeyX);
      stealthResults.splice(insertIdx, 0, changeResult);
    } else {
      sendAmounts.push(changeAmount);
      recipientNpks.push(changeResult.stealthPubKeyX);
      stealthResults.push(changeResult);
    }
  }

  // 5. Compute commitments
  const outCommitments = recipientNpks.map((npk, i) =>
    computeJoinSplitCommitmentSync(npk, tokenId, sendAmounts[i]),
  );

  // 6. Compute bound params hash
  const merkleRoot = inputsData[0].claimInputs.merkleRoot;
  const treeStealthResults = isSpecialOutput ? stealthResults.slice(0, -1) : stealthResults;
  const stealthArraysForHash = treeStealthResults.map((result) => {
    const sd = new Uint8Array(72);
    sd.set(result.ephemeralPub, 0);
    sd.set(result.encryptedAmount, 32);
    return sd;
  });
  const stealthDataHash = computeStealthDataHash(stealthArraysForHash);

  let boundParamsHash: bigint;
  let unshieldRecipientAddress: Uint8Array | undefined;

  if (mode === "btc") {
    if (!inputs.requesterPubkey || inputs.requesterPubkey.length !== 32) {
      throw new Error("btc redeem requires requesterPubkey (32-byte relayer pubkey)");
    }
    const redeemParams = createRedeemBoundParams(
      recipient.btcScriptPubKey!,
      stealthDataHash,
      inputs.requesterPubkey,
      boundChainId,
    );
    boundParamsHash = computeBoundParamsHash(redeemParams);
  } else if (mode === "public") {
    unshieldRecipientAddress = new PublicKey(recipient.solanaAddress!).toBytes();
    const unshieldParams = createUnshieldBoundParams(unshieldRecipientAddress, stealthDataHash, boundChainId);
    boundParamsHash = computeBoundParamsHash(unshieldParams);
  } else {
    const transferParams = createTransferBoundParams(stealthDataHash, boundChainId);
    boundParamsHash = computeBoundParamsHash(transferParams);
  }

  // 7. Sign
  const allNullifiers = inputsData.map((d) => d.claimInputs.nullifier);
  const msgHashInputs = [merkleRoot, boundParamsHash, ...allNullifiers, ...outCommitments];
  const sig = await utxopiaClient.signTransaction(msgHashInputs, keys.eddsaSeed);

  // 8. Build JoinSplit proof inputs
  const nInputs = selectedNotes.length;
  const nOutputs = sendAmounts.length;

  const proofInputs: JoinSplitProofInputs = {
    nInputs,
    nOutputs,
    merkleRoot,
    boundParamsHash,
    token: tokenId,
    publicKey: [keys.spendingPubKey.x, keys.spendingPubKey.y],
    signature: [sig.sigR8x, sig.sigR8y, sig.sigS],
    nullifyingKey: inputsData[0].claimInputs.nullifyingKey,
    inputs: inputsData.map(({ note, claimInputs }) => ({
      random: claimInputs.random,
      value: note.amount,
      leafIndex: BigInt(note.leafIndex),
      merkleProof: {
        siblings: claimInputs.merklePath,
        indices: claimInputs.merkleIndices,
      },
    })),
    outputs: recipientNpks.map((npk, i) => ({
      npk,
      value: sendAmounts[i],
    })),
  };

  // 9. Build stealth data arrays for relay
  const stealthDataArrays = stealthResults.map((result) => {
    const sd = new Uint8Array(72);
    sd.set(result.ephemeralPub, 0);
    sd.set(result.encryptedAmount, 32);
    return sd;
  });

  const relayMode = mode === "btc" ? "redeem" as const : mode === "public" ? "unshield" as const : "transfer" as const;

  return {
    proofInputs,
    stealthDataArrays,
    relayMode,
    unshieldRecipientAddress,
    unshieldMint: tokenMintAddress,
    btcScriptPubKey: recipient.btcScriptPubKey,
    relayerFeeOutputIndex,
    changeSats,
  };
}
