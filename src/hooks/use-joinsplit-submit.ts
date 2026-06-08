"use client";

/**
 * useJoinSplitSubmit — wraps proof generation + relay submission into a single hook.
 * Used by PaymentWizard for all 3 flows.
 */

import { toHex64 } from "@/lib/utils/hex";
import { useState, useCallback } from "react";
import { useProver } from "@/hooks/use-prover";
import type { TransferParams } from "@/hooks/use-build-transfer-params";
import { TOKEN_2022_PROGRAM_ID_STR } from "@/lib/btc-constants";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter } from "@/lib/chain-registry";

export type SubmitStatus = "idle" | "preparing" | "processing" | "submitting" | "success" | "error";

/** Proof generation is pure local compute, so a timeout + retry is always safe
 *  (no on-chain submission has happened yet). Generous bound to avoid false
 *  timeouts on slow mobile devices while still escaping a hung WASM prover. */
const PROOF_TIMEOUT_MS = 120_000;

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => { clearTimeout(timer); resolve(value); },
      (err) => { clearTimeout(timer); reject(err); },
    );
  });
}

export function useJoinSplitSubmit() {
  const prover = useProver();
  const chainEnv = useChainEnvironment();
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
      const { bytesToHex, UTXOpiaClient } = await import("@utxopia/sdk");

      // Initialize prover if needed
      if (!prover.isInitialized) {
        await prover.initialize();
      }

      // Generate ZK proof
      setStatus("processing");
      setStatusMessage("Processing...");
      const { proof: proofData, proofBytes } = await withTimeout(
        prover.generateProof(params.proofInputs),
        PROOF_TIMEOUT_MS,
        "Proof generation timed out. This can happen on slower devices or with large transfers — please try again.",
      );

      // Extract public signals
      setStatus("submitting");
      setStatusMessage("Submitting transaction...");

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
      };

      let relayResult: { success: boolean; signature?: string; error?: string };

      const chainId = getChainAdapter(chainEnv.config).id;
      const relayUrl = chainId === "sui"
        ? `/api/sui/relay?network=${encodeURIComponent(chainEnv.networkId)}`
        : `/api/sol/relay?network=${encodeURIComponent(chainEnv.networkId)}`;

      if (params.relayMode === "unshield" && chainId === "sui") {
        throw new Error("Sui public unshield is not enabled yet");
      }

      if (params.relayMode === "redeem") {
        const treeStealthData = params.stealthDataArrays.slice(0, -1);
        const requestNonce = BigInt(Date.now());
        relayResult = await relayClient.submitToRelay({
          ...commonFields,
          mode: "redeem",
          stealthData: treeStealthData.map((sd) => bytesToHex(sd)),
          redeemAmounts: [(redeemAmountSats ?? 0n).toString()],
          btcScripts: [bytesToHex(params.btcScriptPubKey!)],
          requestNonces: [requestNonce.toString()],
        }, relayUrl);
      } else if (params.relayMode === "unshield") {
        const { getAssociatedTokenAddressSync } = await import("@solana/spl-token");
        const { PublicKey } = await import("@solana/web3.js");
        const recipientPubkey = new PublicKey(params.unshieldRecipientAddress!);
        const zkbtcMint = new PublicKey(chainEnv.config.tokens.zkbtcMint);
        const TOKEN_2022_PID = new PublicKey(TOKEN_2022_PROGRAM_ID_STR);
        const recipientTokenAccount = getAssociatedTokenAddressSync(
          zkbtcMint, recipientPubkey, false, TOKEN_2022_PID,
        );
        const treeStealthData = params.stealthDataArrays.slice(0, -1);

        // Compute unshield amount from proof outputs (last output is unshield)
        const unshieldAmount = Number(params.proofInputs.outputs[params.proofInputs.outputs.length - 1].value);

        relayResult = await relayClient.submitToRelay({
          ...commonFields,
          mode: "unshield",
          stealthData: treeStealthData.map((sd) => bytesToHex(sd)),
          unshieldAmounts: [unshieldAmount.toString()],
          recipientAddresses: [recipientPubkey.toBase58()],
          recipientTokenAccounts: [recipientTokenAccount.toBase58()],
        }, relayUrl);
      } else {
        // Transfer mode: opportunistically attach sender memos so the sender
        // retains an encrypted, AAD-bound record of their own outgoing
        // history. Encryption is to the sender's own `ovk` (derived from
        // their viewing key) — recipients never see it; no third-party can
        // decrypt without an explicit DelegatedViewKey share. Disable by
        // setting NEXT_PUBLIC_DISABLE_SENDER_MEMOS=1.
        let senderMemosHex: string[] | undefined;
        const memoOptOut = process.env.NEXT_PUBLIC_DISABLE_SENDER_MEMOS === "1";
        const senderKeys = relayClient.keys;
        if (!memoOptOut && senderKeys?.viewingPrivKey) {
          try {
            const { buildSenderMemosForTransact, fetchCommitmentTree, hexToBytes } =
              await import("@utxopia/sdk");
            const { Connection, PublicKey } = await import("@solana/web3.js");
            const { deriveCommitmentTreePDA } = await import("@/lib/solana/pdas");

            const rpcUrl = chainEnv.config.solana.rpcUrl;
            if (!rpcUrl) throw new Error("solanaRpcUrl missing from config");
            const connection = new Connection(rpcUrl, "confirmed");
            const [treePda] = deriveCommitmentTreePDA(new PublicKey(chainEnv.config.solana.utxopiaProgramId));

            // fetchCommitmentTree types its `connection` arg as a duck-typed
            // shape that returns `{ data: Uint8Array }`. Solana web3.js
            // Connection returns `{ data: Buffer }`, which is also a
            // Uint8Array at runtime, so this works — cast through unknown to
            // shut TS up.
            const tree = await fetchCommitmentTree(
              connection as unknown as Parameters<typeof fetchCommitmentTree>[0],
              treePda,
            );
            if (tree == null) throw new Error("commitment tree PDA not found");
            const nextIndex = Number(tree.nextIndex);

            const tokenId = params.proofInputs.token;
            const memoOutputs = params.proofInputs.outputs.map((out, i) => ({
              tokenId,
              amount: out.value,
              commitment: hexToBytes(commitmentHexes[i]),
              leafIndex: nextIndex + i,
            }));
            const packed = buildSenderMemosForTransact(senderKeys.viewingPrivKey, memoOutputs);
            senderMemosHex = packed.map((b: Uint8Array) => bytesToHex(b));
          } catch (e) {
            // Sender memos are best-effort: if leaf-index prediction or RPC
            // fails, drop the memo channel for this tx rather than blocking
            // the transfer. The user's outgoing history just has a gap.
            console.warn("[Submit] Skipping sender memos:", e);
            senderMemosHex = undefined;
          }
        }

        relayResult = await relayClient.submitToRelay({
          ...commonFields,
          mode: "transfer",
          stealthData: params.stealthDataArrays.map((sd) => bytesToHex(sd)),
          relayerFeeOutputIndex: params.relayerFeeOutputIndex,
          senderMemos: senderMemosHex,
        }, relayUrl);
      }

      if (!relayResult.success) {
        throw new Error(relayResult.error || "Transaction failed");
      }

      setTxSignature(relayResult.signature ?? null);
      setStatus("success");
      setStatusMessage("");

      // Track tx count for Lite/Pro toggle visibility
      try {
        const count = parseInt(localStorage.getItem("utxopia-tx-count") || "0", 10);
        localStorage.setItem("utxopia-tx-count", String(count + 1));
      } catch {};
    } catch (err) {
      console.error("[Submit] Error:", err);
      setError(err instanceof Error ? err.message : "Transaction failed");
      setStatus("error");
      setStatusMessage("");
    }
  }, [prover, chainEnv]);

  const reset = useCallback(() => {
    setStatus("idle");
    setStatusMessage("");
    setTxSignature(null);
    setError(null);
  }, []);

  return { status, statusMessage, txSignature, error, submit, reset };
}
