"use client";

/**
 * useSuiTransfer — Sui generic `Coin<T>` private transfer (shielded → shielded).
 *
 * Builds JoinSplit proof inputs for a stealth output bound to a recipient's
 * stealth meta-address (plus a change note), generates the proof with the
 * existing prover, and submits to the Sui relay (`mode: "transfer"`), which
 * sponsors gas and inserts the new commitments into the tree. Mirrors
 * useSuiUnshield, but every output is a tree (stealth) output — no public
 * recipient — so the amount and recipient stay hidden on-chain.
 */

import { useCallback, useState } from "react";
import { toHex64 } from "@/lib/utils/hex";
import { canonicalSuiCoinType } from "@/lib/sui/coin-type";
import { useProver } from "@/hooks/use-prover";
import { useChainEnvironment } from "@/lib/chain-environment";
import { withTimeout, PROOF_TIMEOUT_MS } from "@/lib/utils/with-timeout";
import { networkForChain } from "@/lib/chain-registry";
import type { InboxNote } from "@/hooks/use-utxopia";
import type { UTXOpiaKeys, StealthMetaAddress } from "@utxopia/sdk";
import { useRelayCandidates } from "@/hooks/use-relay";
import { submitWithFailover } from "@/lib/relay-submit";

export type SuiTransferStatus = "idle" | "preparing" | "processing" | "submitting" | "success" | "error";

export interface SuiTransferInput {
  /** Fully-qualified Move coin type, e.g. `0x2::sui::SUI`. */
  coinType: string;
  /** Amount to send privately (native units). */
  amount: bigint;
  /** Recipient stealth meta-address (resolved from a name or pasted `utxo:`). */
  recipientMeta: StealthMetaAddress;
  /** Notes to spend (must belong to this coin type's token). */
  selectedNotes: InboxNote[];
  keys: UTXOpiaKeys;
  selfMeta: StealthMetaAddress;
}

export function useSuiTransfer() {
  const prover = useProver();
  const { networkId } = useChainEnvironment();
  const suiNetwork = networkForChain(networkId, "sui");
  const relayCandidates = useRelayCandidates("sui", suiNetwork);

  const [status, setStatus] = useState<SuiTransferStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [txDigest, setTxDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (input: SuiTransferInput) => {
      setStatus("preparing");
      setStatusMessage("Preparing transaction...");
      setError(null);
      setTxDigest(null);

      try {
        const {
          initPoseidon,
          prepareClaimInputs,
          parseMerkleProofResponse,
          computeJoinSplitCommitmentSync,
          createStealthDepositWithKeys,
          computeBoundParamsHash,
          createTransferBoundParams,
          computeStealthDataHash,
          SUI_BOUND_CHAIN_ID,
          UTXOpiaClient,
          bytesToHex,
        } = await import("@utxopia/sdk");
        const { deriveSuiTokenId } = await import("@utxopia/sdk/sui");

        await initPoseidon();

        const tokenId = deriveSuiTokenId(canonicalSuiCoinType(input.coinType));

        const utxopia = UTXOpiaClient.isInitialized ? UTXOpiaClient.instance() : await UTXOpiaClient.init();
        const merkleProofs = await utxopia.fetchMerkleProofs(input.selectedNotes.map((n) => n.commitmentHex));
        if (merkleProofs.length !== input.selectedNotes.length) {
          throw new Error("Merkle proof count mismatch");
        }

        const inputsData = await Promise.all(
          input.selectedNotes.map(async (note, i) => {
            const scannedNote = {
              amount: note.amount,
              ephemeralPub: note.ephemeralPub,
              stealthPub: {
                x: note.stealthPub?.x ?? 0n,
                y: note.stealthPub?.y ?? 0n,
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
            const claimInputs = await prepareClaimInputs(input.keys, scannedNote, parseMerkleProofResponse(merkle));
            return { note, claimInputs };
          }),
        );

        const totalInput = inputsData.reduce((sum, d) => sum + d.note.amount, 0n);
        if (input.amount > totalInput) {
          throw new Error(`Insufficient shielded balance: have ${totalInput}, need ${input.amount}`);
        }

        // Outputs: [recipient, change?]. Every output is a stealth tree output.
        const sendAmounts: bigint[] = [input.amount];
        const stealthResults: Array<Awaited<ReturnType<typeof createStealthDepositWithKeys>>> = [
          await createStealthDepositWithKeys(input.recipientMeta, input.amount, tokenId),
        ];

        const changeAmount = totalInput - input.amount;
        if (changeAmount > 0n) {
          const change = await createStealthDepositWithKeys(input.selfMeta, changeAmount, tokenId);
          sendAmounts.push(changeAmount);
          stealthResults.push(change);
        }

        const recipientNpks = stealthResults.map((r) => r.stealthPubKeyX);
        const outCommitments = recipientNpks.map((npk, i) =>
          computeJoinSplitCommitmentSync(npk, tokenId, sendAmounts[i]),
        );

        // Transfer: all outputs are tree outputs, so every stealth array is hashed.
        const stealthArrays = stealthResults.map((r) => {
          const sd = new Uint8Array(72);
          sd.set(r.ephemeralPub, 0);
          sd.set(r.encryptedAmount, 32);
          return sd;
        });
        const stealthDataHash = computeStealthDataHash(stealthArrays);
        const boundParams = createTransferBoundParams(stealthDataHash, SUI_BOUND_CHAIN_ID);
        const boundParamsHash = computeBoundParamsHash(boundParams);

        const merkleRoot = inputsData[0].claimInputs.merkleRoot;
        const allNullifiers = inputsData.map((d) => d.claimInputs.nullifier);
        const msgHashInputs = [merkleRoot, boundParamsHash, ...allNullifiers, ...outCommitments];
        const sig = await utxopia.signTransaction(msgHashInputs, input.keys.eddsaSeed);

        const proofInputs = {
          nInputs: input.selectedNotes.length,
          nOutputs: sendAmounts.length,
          merkleRoot,
          boundParamsHash,
          token: tokenId,
          publicKey: [input.keys.spendingPubKey.x, input.keys.spendingPubKey.y] as [bigint, bigint],
          signature: [sig.sigR8x, sig.sigR8y, sig.sigS] as [bigint, bigint, bigint],
          nullifyingKey: inputsData[0].claimInputs.nullifyingKey,
          inputs: inputsData.map(({ note, claimInputs }) => ({
            random: claimInputs.random,
            value: note.amount,
            leafIndex: BigInt(note.leafIndex),
            merkleProof: { siblings: claimInputs.merklePath, indices: claimInputs.merkleIndices },
          })),
          outputs: recipientNpks.map((npk, i) => ({ npk, value: sendAmounts[i] })),
        };

        if (!prover.isInitialized) await prover.initialize();
        setStatus("processing");
        setStatusMessage("Processing...");
        const { proof, proofBytes } = await withTimeout(
          prover.generateProof(proofInputs),
          PROOF_TIMEOUT_MS,
          "Proof generation timed out. This can happen on slower devices or with large transfers — please try again.",
        );

        setStatus("submitting");
        setStatusMessage("Submitting transaction...");
        const publicSignals = proof.publicInputs;
        const nIn = proofInputs.nInputs;
        const nOut = proofInputs.nOutputs;
        const merkleRootHex = toHex64(BigInt(publicSignals[0]));
        const boundParamsHashHex = toHex64(BigInt(publicSignals[1]));
        const nullifierHexes = publicSignals.slice(2, 2 + nIn).map((s: string) => toHex64(BigInt(s)));
        const commitmentHexes = publicSignals.slice(2 + nIn, 2 + nIn + nOut).map((s: string) => toHex64(BigInt(s)));

        const result = await submitWithFailover(
          (url) => utxopia.submitToRelay(
            {
              mode: "transfer",
              nInputs: nIn,
              nOutputs: nOut,
              proof: bytesToHex(proofBytes),
              merkleRoot: merkleRootHex,
              boundParamsHash: boundParamsHashHex,
              nullifiers: nullifierHexes,
              commitmentsOut: commitmentHexes,
              stealthData: stealthArrays.map((sd) => bytesToHex(sd)),
            },
            url,
          ),
          relayCandidates,
          {
            onFailover: (failedUrl, nextUrl, err) => {
              console.warn("[SuiTransfer] Relay failed, retrying via another relay...", { failedUrl, nextUrl, err });
            },
          },
        );

        if (!result.success) throw new Error(result.error || "Transfer failed");
        setTxDigest(result.signature ?? null);
        setStatus("success");
        setStatusMessage("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Transfer failed");
        setStatus("error");
        setStatusMessage("");
      }
    },
    [prover, suiNetwork, relayCandidates],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setStatusMessage("");
    setTxDigest(null);
    setError(null);
  }, []);

  return { status, statusMessage, txDigest, error, submit, reset };
}
