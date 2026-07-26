"use client";

/**
 * useJoinSplitSubmit — wraps proof generation + relay submission into a single hook.
 * Used by PaymentWizard for all 3 flows.
 */

import { toHex64 } from "@/lib/utils/hex";
import { useState, useCallback } from "react";
import { useProver } from "@/hooks/use-prover";
import type { TransferParams } from "@/hooks/use-build-transfer-params";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter } from "@/lib/chain-registry";
import { withTimeout, PROOF_TIMEOUT_MS } from "@/lib/utils/with-timeout";
import { useRelayCandidates } from "@/hooks/use-relay";
import { submitWithFailover } from "@/lib/relay-submit";
import {
  finalizePolicyApproval,
  policyStageMessage,
  preparePolicyApproval,
} from "@/lib/policy-approval";

export type SubmitStatus = "idle" | "preparing" | "processing" | "submitting" | "success" | "error";

export interface JoinSplitSubmitResult {
  success: boolean;
  signature: string | null;
}

export function useJoinSplitSubmit() {
  const prover = useProver();
  const chainEnv = useChainEnvironment();
  const chainId = getChainAdapter(chainEnv.config).id;
  const relayCandidates = useRelayCandidates(chainId, chainEnv.networkId, chainEnv.vaultId);
  const [status, setStatus] = useState<SubmitStatus>("idle");
  const [statusMessage, setStatusMessage] = useState("");
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = useCallback(async (params: TransferParams, redeemAmountSats?: bigint) => {
    setStatus("preparing");
    setStatusMessage("Preparing transaction...");
    setError(null);
    setTxSignature(null);

    try {
      const {
        buildRedeemInstructionData,
        buildTransactInstructionData,
        buildUnshieldInstructionData,
        bytesToHex,
        hexToBytes,
        UTXOpiaClient,
      } = await import("@utxopia/sdk");

      // Initialize prover if needed
      if (!prover.isInitialized) {
        await prover.initialize();
      }

      // Generate ZK proof
      setStatus("processing");
      setStatusMessage("Generating privacy proof. Keep this tab open...");
      const { proof: proofData, proofBytes } = await withTimeout(
        prover.generateProof(params.proofInputs),
        PROOF_TIMEOUT_MS,
        "Proof generation timed out. This can happen on slower devices or with large transfers — please try again.",
      );

      // Extract public signals
      setStatus("submitting");
      setStatusMessage("Submitting and confirming on-chain...");

      const publicSignals = proofData.publicInputs;
      const nInputs = params.proofInputs.nInputs;
      const nOutputs = params.proofInputs.nOutputs;

      const merkleRootHex = toHex64(BigInt(publicSignals[0]));
      const boundParamsHashHex = toHex64(BigInt(publicSignals[1]));
      const nullifierHexes = publicSignals.slice(2, 2 + nInputs).map(
        (s: string) => toHex64(BigInt(s)),
      );
      const commitmentHexes = publicSignals.slice(2 + nInputs, 2 + nInputs + nOutputs).map(
        (s: string) => toHex64(BigInt(s)),
      );

      const relayClient = UTXOpiaClient.isInitialized
        ? UTXOpiaClient.instance()
        : await UTXOpiaClient.init();

      const commonFields = {
        nInputs,
        nOutputs,
        proof: bytesToHex(proofBytes),
        merkleRoot: merkleRootHex,
        boundParamsHash: boundParamsHashHex,
        nullifiers: nullifierHexes,
        commitmentsOut: commitmentHexes,
        // Frozen source-tree PDA when a spent note predates a tree rotation; undefined (omitted)
        // for the common single/active-tree case.
        ...(params.sourceTree ? { sourceTree: params.sourceTree } : {}),
      };

      const requestNonce = params.relayMode === "redeem"
        ? BigInt(Date.now())
        : undefined;
      let policyRequestId: string | undefined;
      if (chainEnv.vaultId === "verified") {
        const actorResponse = await fetch(relayCandidates[0]);
        if (!actorResponse.ok) {
          throw new Error("Could not fetch the Verified Privacy relayer");
        }
        const { relayerPubkey } = await actorResponse.json() as {
          relayerPubkey?: string;
        };
        if (!relayerPubkey) {
          throw new Error("Verified Privacy relayer is unavailable");
        }

        const instructionCommon = {
          nInputs,
          nOutputs,
          merkleRoot: hexToBytes(merkleRootHex),
          boundParamsHash: hexToBytes(boundParamsHashHex),
          nullifiers: nullifierHexes.map(hexToBytes),
          commitmentsOut: commitmentHexes.map(hexToBytes),
          proofSource: 1 as const,
        };
        let instructionData: Uint8Array;
        if (params.relayMode === "redeem") {
          instructionData = buildRedeemInstructionData({
            ...instructionCommon,
            nPublicOutputs: 1,
            stealthData: params.stealthDataArrays.slice(0, -1),
            redeemAmounts: [redeemAmountSats ?? 0n],
            btcScripts: [params.btcScriptPubKey!],
            requestNonces: [requestNonce!],
          });
        } else if (params.relayMode === "unshield") {
          const unshieldAmount = BigInt(
            params.proofInputs.outputs[params.proofInputs.outputs.length - 1].value,
          );
          instructionData = buildUnshieldInstructionData({
            ...instructionCommon,
            nPublicOutputs: 1,
            stealthData: params.stealthDataArrays.slice(0, -1),
            unshieldAmounts: [unshieldAmount],
          });
        } else {
          instructionData = buildTransactInstructionData({
            ...instructionCommon,
            stealthData: params.stealthDataArrays,
          });
        }
        const approval = await preparePolicyApproval({
          networkId: chainEnv.networkId,
          vaultId: chainEnv.vaultId,
          actor: relayerPubkey,
          instructionData,
          onStage: (stage) => setStatusMessage(policyStageMessage(stage)),
        });
        policyRequestId = approval.requestId;
        setStatusMessage(policyStageMessage("awaiting_signature"));
      }

      let relayResult: {
        success: boolean;
        signature?: string;
        error?: string;
        policyRequestId?: string;
      };

      const onFailover = (failedUrl: string, nextUrl: string, err: unknown) => {
        console.warn("[Submit] Relay failed, retrying via another relay...", { failedUrl, nextUrl, err });
      };

      if (params.relayMode === "redeem") {
        const treeStealthData = params.stealthDataArrays.slice(0, -1);
        relayResult = await submitWithFailover(
          (url) => relayClient.submitToRelay({
            ...commonFields,
            mode: "redeem",
            stealthData: treeStealthData.map((sd) => bytesToHex(sd)),
            redeemAmounts: [(redeemAmountSats ?? 0n).toString()],
            btcScripts: [bytesToHex(params.btcScriptPubKey!)],
            requestNonces: [requestNonce!.toString()],
            ...(policyRequestId ? { policyRequestId } : {}),
          }, url),
          relayCandidates,
          { onFailover },
        );
      } else if (params.relayMode === "unshield") {
        const { PublicKey } = await import("@solana/web3.js");
        const recipientPubkey = new PublicKey(params.unshieldRecipientAddress!);
        const treeStealthData = params.stealthDataArrays.slice(0, -1);

        // Compute unshield amount from proof outputs (last output is unshield)
        const unshieldAmount = Number(params.proofInputs.outputs[params.proofInputs.outputs.length - 1].value);

        // Pass the token mint via the URL (mirrors Sui's coinType): the relay
        // derives the token program, pool vault, token config and recipient ATA
        // from it, so any SPL token can be cashed out. Defaults to zkBTC, which
        // derives the same accounts as before — byte-identical for zkBTC.
        const unshieldMint = params.unshieldMint || chainEnv.config.tokens.zkbtcMint;

        relayResult = await submitWithFailover(
          (url) => relayClient.submitToRelay({
            ...commonFields,
            mode: "unshield",
            stealthData: treeStealthData.map((sd) => bytesToHex(sd)),
            unshieldAmounts: [unshieldAmount.toString()],
            recipientAddresses: [recipientPubkey.toBase58()],
            ...(policyRequestId ? { policyRequestId } : {}),
          }, `${url}&unshieldMint=${encodeURIComponent(unshieldMint)}`),
          relayCandidates,
          { onFailover },
        );
      } else {
        relayResult = await submitWithFailover(
          (url) => relayClient.submitToRelay({
            ...commonFields,
            mode: "transfer",
            stealthData: params.stealthDataArrays.map((sd) => bytesToHex(sd)),
            relayerFeeOutputIndex: params.relayerFeeOutputIndex,
            ...(policyRequestId ? { policyRequestId } : {}),
          }, url),
          relayCandidates,
          { onFailover },
        );
      }

      if (!relayResult.success) {
        throw new Error(relayResult.error || "Transaction failed");
      }
      if (!relayResult.signature) {
        throw new Error("Relay accepted the request but did not return a transaction signature");
      }
      if (policyRequestId) {
        await finalizePolicyApproval({
          networkId: chainEnv.networkId,
          vaultId: chainEnv.vaultId,
          requestId: relayResult.policyRequestId || policyRequestId,
          signature: relayResult.signature,
          onStage: (stage) => setStatusMessage(policyStageMessage(stage)),
        });
      }

      setTxSignature(relayResult.signature);
      setStatus("success");
      setStatusMessage("");

      // Track tx count for Lite/Pro toggle visibility
      try {
        const count = parseInt(localStorage.getItem("utxopia-tx-count") || "0", 10);
        localStorage.setItem("utxopia-tx-count", String(count + 1));
      } catch {};
      return { success: true, signature: relayResult.signature } satisfies JoinSplitSubmitResult;
    } catch (err) {
      console.error("[Submit] Error:", err);
      setError(err instanceof Error ? err.message : "Transaction failed");
      setStatus("error");
      setStatusMessage("");
      return { success: false, signature: null } satisfies JoinSplitSubmitResult;
    }
  }, [prover, chainEnv, chainId, relayCandidates]);

  const reset = useCallback(() => {
    setStatus("idle");
    setStatusMessage("");
    setTxSignature(null);
    setError(null);
  }, []);

  return {
    status,
    statusMessage,
    txSignature,
    error,
    submit,
    reset,
    preloadCircuit: prover.preloadCircuit,
  };
}
