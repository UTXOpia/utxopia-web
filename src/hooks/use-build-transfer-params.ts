"use client";

/**
 * buildTransferParams — pure function that translates user inputs into JoinSplitProofInputs.
 *
 * Single source of truth for all 3 simplified flows (transfer, unshield, withdraw).
 * Extracted from pay-flow.tsx to prevent logic drift between flows.
 */

import { toHex64 } from "@/lib/utils/hex";
import { computeSolanaDomainBoundParamsHash } from "@/lib/solana-domain-binding";
import { renderSpendDoc, type SpendDoc } from "@utxopia/sdk";
import { PublicKey } from "@solana/web3.js";
import type { InboxNote } from "@/hooks/use-utxopia";
import type { JoinSplitProofInputs, UTXOpiaKeys, StealthMetaAddress, ScannedNote } from "@utxopia/sdk";

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
  /** Redeem (btc) only: withdrawal service fee model read from relay meta. */
  serviceFeeBase?: number;
  serviceFeeBps?: number;
  /** Chain id folded into bound params (Solana 103). */
  boundChainId: bigint;
  /** Privacy domain bound into the proof's public boundParamsHash. */
  privacyDomain: "public" | "institution";
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
  /**
   * Frozen source-tree PDA (base58) when a spent note predates a tree rotation (its tree index <
   * the active index). Forwarded to the relay so the program proves membership against that tree.
   * Undefined for the common single/active-tree case. Detection requires per-note tree indices,
   * which the indexer records only after a rotation occurs.
   */
  sourceTree?: string;
  /**
   * The statement shown to the user at confirm time. `recipientBytes` is filled
   * in here from the resolved destination, then the whole doc is checked against
   * the proof's public signals — a mismatch aborts before anything is signed.
   * Omitted only by flows with no confirm step (claim links), which fall back to
   * a doc built from these same values.
   */
  spendDoc?: SpendDoc;
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
  /**
   * Frozen source-tree PDA (base58) when a spent note predates a tree rotation. The relay inserts
   * it before the proof buffer so the program proves membership against that tree while inserting
   * new outputs into the active tree. Undefined for the common single/active-tree case.
   */
  sourceTree?: string;
  /**
   * Canonical statement of what this proof proves. Cross-checked against the
   * public signals — it cannot be built if the numbers diverge. Show it before
   * proving.
   */
  spendDoc: string;
}

export async function buildTransferParams(inputs: TransferUserInputs): Promise<TransferParams> {
  const {
    initPoseidon,
    prepareClaimInputs,
    parseMerkleProofResponse,
    computeJoinSplitCommitmentSync,
    createStealthDepositWithKeys,
    createUnshieldBoundParams,
    createRedeemBoundParams,
    createTransferBoundParams,
    computeStealthDataHash,
    UTXOpiaClient,
  } = await import("@utxopia/sdk");

  await initPoseidon();

  const { mode, amountSats, selectedNotes, keys, selfMeta, relayerMeta, relayerFee, recipient, boundChainId } = inputs;

  if (mode === "btc") {
    const base = BigInt(Math.max(0, Math.floor(inputs.serviceFeeBase ?? 0)));
    const bps = BigInt(Math.max(0, Math.floor(inputs.serviceFeeBps ?? 0)));
    const serviceFee = (amountSats * bps) / 10_000n + base;
    if (amountSats <= serviceFee) {
      throw new Error(
        `BTC withdrawal amount must exceed the service fee (${serviceFee} sats).`,
      );
    }
  }

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
  const domainContext = {
    programId: new PublicKey(utxopiaClient.config.utxopiaProgramId).toBytes(),
    poolState: new PublicKey(utxopiaClient.config.poolStatePda).toBytes(),
    kind: inputs.privacyDomain,
  } as const;

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
    // Public outputs are burns, not private notes. The on-chain redeem
    // instruction verifies Poseidon(0, token_id, amount) for this final output.
    recipientNpks.push(0n);
    stealthResults.push({
      ephemeralPub: new Uint8Array(32),
      encryptedAmount: new Uint8Array(8),
      commitment: new Uint8Array(32),
      stealthPubKeyX: 0n,
      npkBytes: new Uint8Array(32),
    });
  } else if (mode === "public") {
    // The public recipient is bound separately. The final circuit output is a
    // zero-owner burn commitment, matching the unshield program check.
    recipientNpks.push(0n);
    stealthResults.push({
      ephemeralPub: new Uint8Array(32),
      encryptedAmount: new Uint8Array(8),
      commitment: new Uint8Array(32),
      stealthPubKeyX: 0n,
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
    if (!relayerMeta) {
      throw new Error(
        "Relayer fee address is unavailable. Please wait for relayer configuration and try again.",
      );
    }
    const feeAmount = BigInt(relayerFee);
    const feeResult = await createStealthDepositWithKeys(relayerMeta, feeAmount, tokenId);

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
    boundParamsHash = computeSolanaDomainBoundParamsHash(redeemParams, domainContext);
  } else if (mode === "public") {
    unshieldRecipientAddress = new PublicKey(recipient.solanaAddress!).toBytes();
    const unshieldParams = createUnshieldBoundParams(unshieldRecipientAddress, stealthDataHash, boundChainId);
    boundParamsHash = computeSolanaDomainBoundParamsHash(unshieldParams, domainContext);
  } else {
    const transferParams = createTransferBoundParams(stealthDataHash, boundChainId);
    boundParamsHash = computeSolanaDomainBoundParamsHash(transferParams, domainContext);
  }

  const relayMode = mode === "btc" ? "redeem" as const : mode === "public" ? "unshield" as const : "transfer" as const;

  // 6b. Verify the statement the user was shown against the signals about to be
  //     proven. renderSpendDoc re-derives boundParamsHash from the destination it
  //     prints and matches every printed amount against the proof's outputs, so a
  //     divergence throws here instead of becoming a proof nobody agreed to.
  const doc: SpendDoc = inputs.spendDoc ?? {
    mode: relayMode,
    network: "Solana",
    asset: "zkBTC",
    decimals: 8,
    recipient: recipient.solanaAddress ?? "shielded recipient",
    amount: amountSats,
    relayerFee: BigInt(relayerFee),
    change: BigInt(changeSats),
  };
  const spendDoc = renderSpendDoc(
    {
      ...doc,
      recipientBytes:
        mode === "public" ? unshieldRecipientAddress
        : mode === "btc" ? recipient.btcScriptPubKey
        : undefined,
    },
    {
      outputValues: sendAmounts,
      boundParamsHash,
      stealthDataHash,
      chainId: boundChainId,
      domain: domainContext,
      requester: inputs.requesterPubkey,
    },
  );

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


  return {
    proofInputs,
    stealthDataArrays,
    relayMode,
    unshieldRecipientAddress,
    unshieldMint: tokenMintAddress,
    btcScriptPubKey: recipient.btcScriptPubKey,
    relayerFeeOutputIndex,
    changeSats,
    sourceTree: inputs.sourceTree,
    spendDoc,
  };
}
