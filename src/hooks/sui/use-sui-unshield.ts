"use client";

/**
 * useSuiUnshield — Sui generic `Coin<T>` unshield (private balance → public address).
 *
 * Builds JoinSplit proof inputs for a single public output bound to a Sui
 * recipient address, generates the proof with the existing prover, and submits
 * to the Sui relay (`mode: "unshield"`), which sponsors gas and releases the
 * Coin<T> on-chain. Mirrors the transfer/redeem wiring but Sui-address bound.
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

export type SuiUnshieldStatus = "idle" | "preparing" | "processing" | "submitting" | "success" | "error";

export interface SuiUnshieldInput {
  /** Fully-qualified Move coin type, e.g. `0x2::sui::SUI`. */
  coinType: string;
  /** Amount to release publicly (native units). */
  amount: bigint;
  /** Recipient Sui address (0x-prefixed 32-byte hex). */
  recipient: string;
  /** Notes to spend (must belong to this coin type's token). */
  selectedNotes: InboxNote[];
  keys: UTXOpiaKeys;
  selfMeta: StealthMetaAddress;
}

/** 0x-prefixed 32-byte Sui address → raw 32-byte big-endian. */
function suiAddressToBytes(address: string): Uint8Array {
  const hex = address.startsWith("0x") ? address.slice(2) : address;
  if (!/^[0-9a-fA-F]+$/.test(hex) || hex.length > 64) {
    throw new Error("Invalid Sui recipient address");
  }
  const padded = hex.padStart(64, "0");
  const bytes = new Uint8Array(32);
  for (let i = 0; i < 32; i += 1) {
    bytes[i] = parseInt(padded.slice(i * 2, i * 2 + 2), 16);
  }
  return bytes;
}

export function useSuiUnshield() {
  const prover = useProver();
  const { networkId } = useChainEnvironment();
  const suiNetwork = networkForChain(networkId, "sui");
  const relayCandidates = useRelayCandidates("sui", suiNetwork);

  const [status, setStatus] = useState<SuiUnshieldStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [txDigest, setTxDigest] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(
    async (input: SuiUnshieldInput) => {
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
          computeSuiUnshieldBoundParamsHash,
          UTXOpiaClient,
          bytesToHex,
        } = await import("@utxopia/sdk");
        const { deriveSuiTokenId } = await import("@utxopia/sdk/sui");

        await initPoseidon();

        const tokenId = deriveSuiTokenId(canonicalSuiCoinType(input.coinType));
        const recipientBytes = suiAddressToBytes(input.recipient);

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

        // Outputs: [public unshield, change?]. The public output's npk is the
        // reduced recipient address; tree outputs use stealth keys.
        const { reduceToField } = await import("@utxopia/sdk");
        const recipientNpk = reduceToField(recipientBytes);
        const sendAmounts: bigint[] = [input.amount];
        const recipientNpks: bigint[] = [recipientNpk];
        const stealthResults: Array<Awaited<ReturnType<typeof createStealthDepositWithKeys>>> = [
          {
            ephemeralPub: new Uint8Array(32),
            encryptedAmount: new Uint8Array(8),
            commitment: new Uint8Array(32),
            stealthPubKeyX: recipientNpk,
            npkBytes: new Uint8Array(32),
          },
        ];

        const totalInput = inputsData.reduce((sum, d) => sum + d.note.amount, 0n);
        if (input.amount > totalInput) {
          throw new Error(`Insufficient shielded balance: have ${totalInput}, need ${input.amount}`);
        }
        const changeAmount = totalInput - input.amount;
        if (changeAmount > 0n) {
          const change = await createStealthDepositWithKeys(input.selfMeta, changeAmount, tokenId);
          // Insert change before the public output (tree outputs come first).
          sendAmounts.splice(0, 0, changeAmount);
          recipientNpks.splice(0, 0, change.stealthPubKeyX);
          stealthResults.splice(0, 0, change);
        }

        const outCommitments = recipientNpks.map((npk, i) =>
          computeJoinSplitCommitmentSync(npk, tokenId, sendAmounts[i]),
        );

        // Tree outputs = all but the trailing public output.
        const treeStealthResults = stealthResults.slice(0, -1);
        const stealthArraysForHash = treeStealthResults.map((r) => {
          const sd = new Uint8Array(72);
          sd.set(r.ephemeralPub, 0);
          sd.set(r.encryptedAmount, 32);
          return sd;
        });
        // Length-prefixed Sui bound-params (audit #4/#51-54) — must match the on-chain
        // bound_params.move encoding (count + per-item length). `recipients` is the
        // vector<address> the program hashes; single-output here, so a 1-element list.
        const boundParamsHash = computeSuiUnshieldBoundParamsHash([recipientBytes], stealthArraysForHash);

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

        const treeStealthData = stealthArraysForHash;
        // coinType travels in the query string — it is not part of the typed relay payload.
        // Applied per-candidate so failover carries the same coinType suffix.
        const result = await submitWithFailover(
          (url) => utxopia.submitToRelay(
            {
              mode: "unshield",
              nInputs: nIn,
              nOutputs: nOut,
              proof: bytesToHex(proofBytes),
              merkleRoot: merkleRootHex,
              boundParamsHash: boundParamsHashHex,
              nullifiers: nullifierHexes,
              commitmentsOut: commitmentHexes,
              stealthData: treeStealthData.map((sd) => bytesToHex(sd)),
              unshieldAmounts: [input.amount.toString()],
              recipientAddresses: [input.recipient],
            },
            `${url}&coinType=${encodeURIComponent(input.coinType)}`,
          ),
          relayCandidates,
          {
            onFailover: (failedUrl, nextUrl, err) => {
              console.warn("[SuiUnshield] Relay failed, retrying via another relay...", { failedUrl, nextUrl, err });
            },
          },
        );

        if (!result.success) throw new Error(result.error || "Unshield failed");
        setTxDigest(result.signature ?? null);
        setStatus("success");
        setStatusMessage("");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Unshield failed");
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
