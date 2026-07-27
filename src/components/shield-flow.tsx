"use client";

import { useState, useCallback, useEffect, useRef } from "react";
import Image from "next/image";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import {
  getAssociatedTokenAddressSync,
  createAssociatedTokenAccountIdempotentInstruction,
  createSyncNativeInstruction,
  createCloseAccountInstruction,
  NATIVE_MINT,
  TOKEN_PROGRAM_ID as SPL_TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { UTXOpiaClient } from "@utxopia/sdk";
import { deriveTokenConfigPDA } from "@/lib/solana/pdas";
import { useUTXOpia } from "@/hooks/use-utxopia";
import { Shield, ChevronDown, Loader2, AlertCircle, LogOut, Wallet, Copy, Check, Info, ExternalLink, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { StealthRecipientInput } from "@/components/ui/stealth-recipient-input";
import { TextShimmer } from "@/components/ui/text-shimmer";
import type { StealthMetaAddress } from "@utxopia/sdk";
import { SHIELD_TOKENS } from "@/lib/supported-tokens";

import { MobileWalletGuidance } from "@/components/bitcoin-wallet-selector";
import { useIsMobileWithoutWallet } from "@/hooks/use-mobile-wallet-detect";
import { BTC_DUST_LIMIT, TOKEN_2022_PROGRAM_ID_STR } from "@/lib/btc-constants";
import { useTokenBalance } from "@/hooks/use-token-balance";
import { useBtcDeposit } from "@/hooks/use-btc-deposit";
import { BtcDepositPreview } from "@/components/shield-flow/btc-deposit-preview";
import { ShieldSuccess } from "@/components/shield-flow/shield-success";
import { TokenSelector } from "@/components/shield-flow/token-selector";
import { BtcFaucetPrompt } from "@/components/shield-flow/btc-faucet-prompt";
import { SolTestFundsHelper, SplTestFundsHelper } from "@/components/shield-flow/test-funds-helper";
import { useChainEnvironment } from "@/lib/chain-environment";
import { isChainHybridNetwork } from "@/lib/chain-registry";
import { usePoolPermissioned } from "@/hooks/use-pool-permissioned";
import { confirmSubmittedSignature } from "@/lib/solana/confirm-signature";
import { usePoolFees } from "@/hooks/use-pool-fees";
import { computeBpsFee, feeShareBps } from "@/lib/pool-fees";
import { formatAmount } from "@/lib/utils/formatting";
import { getSolanaExplorerTxUrl } from "@/lib/solana-network";
import {
  finalizePolicyApproval,
  isPolicyRejection,
  policyStageMessage,
  preparePolicyApproval,
} from "@/lib/policy-approval";
import { ApplyForAccess } from "@/components/apply-for-access";

const TOKEN_2022_PROGRAM_ID = new PublicKey(TOKEN_2022_PROGRAM_ID_STR);

interface ShieldFlowProps {
  className?: string;
}

type ShieldStatus = "idle" | "processing" | "unknown" | "done" | "error";

export function ShieldFlow({ className }: ShieldFlowProps) {
  const wallet = useWallet();
  const { publicKey, sendTransaction } = wallet;
  const { connection } = useConnection();
  const chainEnv = useChainEnvironment();
  const { networkId } = chainEnv;
  const { permissioned: poolPermissioned } = usePoolPermissioned();
  const { setVisible: openWalletModal } = useWalletModal();
  const { keys, stealthAddress } = useUTXOpia();
  const poolFees = usePoolFees();

  // Passkey users have keys but no Solana wallet — need to connect wallet for SPL shielding
  const isPasskeyOnly = !!keys && !publicKey;
  // Show all tokens for everyone — prompt wallet connection if needed for SPL
  const availableTokens = SHIELD_TOKENS;

  const [selectedToken, setSelectedToken] = useState(availableTokens[0]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [amount, setAmount] = useState("");
  const [resolvedMeta, setResolvedMeta] = useState<StealthMetaAddress | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [status, setStatus] = useState<ShieldStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txSig, setTxSig] = useState<string | null>(null);
  const [policyMessage, setPolicyMessage] = useState<string | null>(null);
  const [copiedAddr, setCopiedAddr] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // ── BTC-specific state (extracted to hook) ──
  const btcDeposit = useBtcDeposit({
    resolvedMeta,
    onStatusChange: (s) => setStatus(s),
    onError: (msg) => setError(msg || null),
  });
  const {
    btcWallet,
    walletPickerRef,
    showWalletPicker,
    setShowWalletPicker,
    btcAmount,
    setBtcAmount,
    copiedBtcAddr,
    setCopiedBtcAddr,
    depositPreview,
    walletDepositResult,
    setWalletDepositResult,
    buildingPreview,
    buildTxPreview,
  } = btcDeposit;
  const { solBalance, splBalance, handleMax, refreshBalance } = useTokenBalance(
    selectedToken,
    publicKey,
    connection,
    btcWallet.balance,
    chainEnv.config.tokens.zkbtcMint,
  );
  const isMobileNoWallet = useIsMobileWithoutWallet();

  // Close dropdown on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
      if (walletPickerRef.current && !walletPickerRef.current.contains(e.target as Node)) {
        setShowWalletPicker(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [setShowWalletPicker, walletPickerRef]);

  // No auto-resolve — user clicks the Self button or types a recipient.
  // This avoids resolvedMeta getting out of sync with the input value.

  const onMax = useCallback(() => {
    const max = handleMax();
    if (selectedToken.isBtcNative) setBtcAmount(max);
    else setAmount(max);
  }, [handleMax, selectedToken.isBtcNative, setBtcAmount]);

  const handleShield = useCallback(async () => {
    if (!publicKey || !keys || !amount || !resolvedMeta) return;

    try {
      setStatus("processing");
      setError(null);
      setPolicyMessage(null);

      const amountRaw = BigInt(Math.floor(parseFloat(amount) * (10 ** selectedToken.decimals)));
      const quotedDepositFeeBps = poolFees.fees?.depositFeeBps;
      const latestFees = await poolFees.refresh();
      if (quotedDepositFeeBps == null || latestFees.depositFeeBps !== quotedDepositFeeBps) {
        setStatus("idle");
        throw new Error("The shield fee changed. Review the updated amount and confirm again.");
      }

      // Determine mint: SOL uses native wSOL, others use their configured mint
      const mintPubkey = selectedToken.isSOL
        ? NATIVE_MINT
        : selectedToken.mint
          ? new PublicKey(selectedToken.mint)
          : new PublicKey(chainEnv.config.tokens.zkbtcMint);

      const client = UTXOpiaClient.instance();
      const mintAddr = mintPubkey.toBase58();
      const shieldOutput = await client.prepareShieldOutput({ amount: amountRaw, mintAddress: mintAddr });
      const { npkBytes } = shieldOutput;

      const programId = new PublicKey(chainEnv.config.solana.utxopiaProgramId);
      const [tokenConfigPda] = deriveTokenConfigPDA(mintPubkey, programId);
      const poolStatePda = new PublicKey(chainEnv.config.solana.poolState!);
      const commitmentTreePda = new PublicKey(
        chainEnv.config.solana.commitmentTree!,
      );

      const ixData = new Uint8Array(73);
      ixData[0] = chainEnv.vaultId === "verified" ? 23 : 12;
      const dataView = new DataView(ixData.buffer);
      dataView.setBigUint64(1, amountRaw, true);
      ixData.set(npkBytes, 9);
      ixData.set(shieldOutput.ephemeralPub, 41);

      let policyRequestId: string | undefined;
      let approvalAccount: PublicKey | undefined;
      if (chainEnv.vaultId === "verified") {
        const approval = await preparePolicyApproval({
          networkId: chainEnv.networkId,
          vaultId: chainEnv.vaultId,
          actor: publicKey.toBase58(),
          instructionData: ixData,
          onStage: (stage) => setPolicyMessage(policyStageMessage(stage)),
        });
        policyRequestId = approval.requestId;
        approvalAccount = new PublicKey(approval.approvalAccount);
      }

      const tx = new Transaction();
      let userTokenAccount: PublicKey;

      if (selectedToken.isSOL) {
        // SOL shielding: wrap SOL → wSOL (native, legacy Token program) → shield → close wSOL account
        const wsolAta = getAssociatedTokenAddressSync(
          NATIVE_MINT,
          publicKey,
          false,
          SPL_TOKEN_PROGRAM_ID,
        );

        // 1. Create wSOL ATA if needed (idempotent)
        tx.add(
          createAssociatedTokenAccountIdempotentInstruction(
            publicKey,
            wsolAta,
            publicKey,
            NATIVE_MINT,
            SPL_TOKEN_PROGRAM_ID,
          ),
        );

        // 2. Transfer SOL → wSOL ATA
        tx.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: wsolAta,
            lamports: Number(amountRaw),
          }),
        );

        // 3. Sync native balance
        tx.add(
          createSyncNativeInstruction(wsolAta, SPL_TOKEN_PROGRAM_ID),
        );

        userTokenAccount = wsolAta;

        // Read vault from TokenConfig PDA on-chain
        const tokenConfigAccount = await connection.getAccountInfo(tokenConfigPda);
        if (!tokenConfigAccount) {
          throw new Error("SOL is not available on this network yet.");
        }
        // vault is at offset 66..98 in TokenConfig (disc:1 + bump:1 + mint:32 + tokenId:32 = 66)
        const vaultBytes = tokenConfigAccount.data.slice(66, 98);
        const vaultPubkey = new PublicKey(vaultBytes);

        // 4. Shield instruction (use legacy Token program for wSOL)
        tx.add(new TransactionInstruction({
          programId,
          data: Buffer.from(ixData),
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: poolStatePda, isSigner: false, isWritable: true },
            { pubkey: tokenConfigPda, isSigner: false, isWritable: true },
            { pubkey: vaultPubkey, isSigner: false, isWritable: true },
            { pubkey: commitmentTreePda, isSigner: false, isWritable: true },
            { pubkey: new PublicKey(SPL_TOKEN_PROGRAM_ID), isSigner: false, isWritable: false },
            ...(approvalAccount
              ? [
                  { pubkey: approvalAccount, isSigner: false, isWritable: true },
                  {
                    pubkey: new PublicKey(chainEnv.config.solana.policyProgramId!),
                    isSigner: false,
                    isWritable: false,
                  },
                ]
              : []),
          ],
        }));

        // 5. Close wSOL account to reclaim rent (returns leftover SOL to user)
        tx.add(
          createCloseAccountInstruction(wsolAta, publicKey, publicKey, [], SPL_TOKEN_PROGRAM_ID),
        );
      } else {
        // SPL token shielding (zkBTC, USDC, etc.). The pool accepts both classic
        // SPL Token and Token-2022 (on-chain validate_any_token_program_key), so
        // detect the mint's actual program rather than assuming Token-2022 — a
        // mint account is owned by its token program.
        const mintInfo = await connection.getAccountInfo(mintPubkey);
        if (!mintInfo) {
          throw new Error(`${selectedToken.symbol} mint not found on this network.`);
        }
        const classicTokenProgram = new PublicKey(SPL_TOKEN_PROGRAM_ID);
        if (!mintInfo.owner.equals(TOKEN_2022_PROGRAM_ID) && !mintInfo.owner.equals(classicTokenProgram)) {
          throw new Error(`${selectedToken.symbol} uses an unsupported token program.`);
        }
        const tokenProgramId = mintInfo.owner;

        const tokenAccounts = await connection.getTokenAccountsByOwner(publicKey, {
          mint: mintPubkey,
          programId: tokenProgramId,
        });

        if (tokenAccounts.value.length === 0) {
          throw new Error(`You don't hold any ${selectedToken.symbol} in this wallet to add.`);
        }
        userTokenAccount = tokenAccounts.value[0].pubkey;

        // Read vault from TokenConfig PDA (same approach as SOL path)
        const tokenConfigAccount = await connection.getAccountInfo(tokenConfigPda);
        if (!tokenConfigAccount) {
          throw new Error(`${selectedToken.symbol} token not registered on-chain. Admin must register it first.`);
        }
        // vault is at offset 66..98 in TokenConfig (disc:1 + bump:1 + mint:32 + tokenId:32 = 66)
        const vaultBytes = tokenConfigAccount.data.slice(66, 98);
        const vaultPubkey = new PublicKey(vaultBytes);

        tx.add(new TransactionInstruction({
          programId,
          data: Buffer.from(ixData),
          keys: [
            { pubkey: publicKey, isSigner: true, isWritable: true },
            { pubkey: userTokenAccount, isSigner: false, isWritable: true },
            { pubkey: poolStatePda, isSigner: false, isWritable: true },
            { pubkey: tokenConfigPda, isSigner: false, isWritable: true },
            { pubkey: vaultPubkey, isSigner: false, isWritable: true },
            { pubkey: commitmentTreePda, isSigner: false, isWritable: true },
            { pubkey: tokenProgramId, isSigner: false, isWritable: false },
            ...(approvalAccount
              ? [
                  { pubkey: approvalAccount, isSigner: false, isWritable: true },
                  {
                    pubkey: new PublicKey(chainEnv.config.solana.policyProgramId!),
                    isSigner: false,
                    isWritable: false,
                  },
                ]
              : []),
          ],
        }));
      }

      const sig = await sendTransaction(tx, connection);
      setTxSig(sig);
      try {
        await confirmSubmittedSignature(connection, sig);
      } catch (confirmationError) {
        const message = confirmationError instanceof Error ? confirmationError.message : "Confirmation is taking longer than expected.";
        if (message.includes("still pending") || message.includes("submitted")) {
          setError("Confirmation is taking longer than expected. The transaction may still confirm on-chain.");
          setStatus("unknown");
          return;
        }
        throw confirmationError;
      }
      if (policyRequestId) {
        await finalizePolicyApproval({
          networkId: chainEnv.networkId,
          vaultId: chainEnv.vaultId,
          requestId: policyRequestId,
          signature: sig,
          onStage: (stage) => setPolicyMessage(policyStageMessage(stage)),
        });
      }

      setStatus("done");
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : "Add funds failed");
      setStatus("error");
    }
  }, [publicKey, keys, selectedToken, amount, resolvedMeta, connection, sendTransaction, chainEnv.config, poolFees]);

  const amountRaw = BigInt(Math.max(0, Math.floor(parseFloat(amount || "0") * (10 ** selectedToken.decimals))));
  const depositFee = computeBpsFee(amountRaw, poolFees.fees?.depositFeeBps ?? 0);
  const privateReceives = amountRaw > depositFee ? amountRaw - depositFee : 0n;
  const displayUnit = selectedToken.isSOL ? "SOL" : selectedToken.symbol;
  const privateUnit = selectedToken.isSOL ? "zkSOL" : `zk${selectedToken.symbol.replace(/^zk/, "")}`;
  const formatBaseUnits = (value: bigint) => formatAmount(Number(value), selectedToken.decimals);
  const highDepositFee = feeShareBps(depositFee, amountRaw) >= 500;
  const publicBalance = selectedToken.isSOL ? solBalance : splBalance;
  const publicBalanceRaw = publicBalance === null
    ? null
    : BigInt(Math.max(0, Math.floor(publicBalance)));
  const hasEnoughPublicBalance = publicBalanceRaw !== null && amountRaw <= publicBalanceRaw;
  const needsTestFunds = publicBalanceRaw !== null
    && (publicBalanceRaw === 0n || (amountRaw > 0n && amountRaw > publicBalanceRaw));
  const splFaucetToken = selectedToken.symbol === "USDC" || selectedToken.symbol === "USDT"
    ? selectedToken.symbol
    : null;
  const showSplTestFunds = !!publicKey
    && !!splFaucetToken
    && isChainHybridNetwork(networkId, "solana")
    && needsTestFunds;
  const showSolTestFunds = !!publicKey
    && selectedToken.isSOL
    && networkId !== "mainnet"
    && networkId !== "localnet"
    && needsTestFunds;
  const canSubmit = !!amount
    && parseFloat(amount) > 0
    && !!resolvedMeta
    && !!publicKey
    && !!keys
    && !!poolFees.fees
    && hasEnoughPublicBalance;

  const checkDepositAgain = useCallback(async () => {
    if (!txSig) return;
    setStatus("processing");
    setError(null);
    try {
      await confirmSubmittedSignature(connection, txSig);
      setStatus("done");
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not confirm the transaction.";
      if (message.includes("still pending") || message.includes("submitted")) {
        setError("Still waiting for on-chain confirmation. Your funds have not been marked as failed.");
        setStatus("unknown");
      } else {
        setError(message);
        setStatus("error");
      }
    }
  }, [connection, txSig]);

  // Success state
  if (status === "done") {
    const resetDone = () => {
      setStatus("idle");
      setAmount("");
      setBtcAmount("");
      setTxSig(null);
      setWalletDepositResult(null);
    };

    return (
      <ShieldSuccess
        className={className}
        selectedToken={selectedToken}
        txSig={txSig}
        walletDepositResult={walletDepositResult}
        onReset={resetDone}
      />
    );
  }

  // Token selector dropdown — shared across both flows
  const tokenSelector = (
    <TokenSelector
      selectedToken={selectedToken}
      availableTokens={availableTokens}
      dropdownOpen={dropdownOpen}
      dropdownRef={dropdownRef}
      onOpenChange={setDropdownOpen}
      onSelect={setSelectedToken}
    />
  );

  // BTC native deposit flow — unified layout matching SPL flow
  if (selectedToken.isBtcNative) {
    const btcAmountSats = Math.floor(parseFloat(btcAmount || "0") * 1e8);
    const canSubmitBtc = btcAmountSats > 0 && !!resolvedMeta && !!keys;
    const usesBtcFaucet = chainEnv.config.bitcoin.network !== "mainnet";

    if (usesBtcFaucet) {
      return (
        <BtcFaucetPrompt
          networkId={networkId}
          tokenSelector={tokenSelector}
          className={className}
        />
      );
    }

    // PSBT preview active — show transaction details
    if (depositPreview) {
      return (
        <BtcDepositPreview
          className={className}
          btcDeposit={btcDeposit}
          status={status === "unknown" ? "error" : status}
          error={error}
        />
      );
    }

    // Main BTC form — unified layout
    return (
      <div className={cn("space-y-5", className)}>
        {/* BTC Wallet bar */}
        <div className="flex items-center justify-between gap-2">
          {btcWallet.connected ? (
            <div className="flex items-center gap-1.5 min-w-0">
              <Image src="/tokens/btc.png" alt="BTC" width={14} height={14} className="rounded-full shrink-0" />
              <code className="text-[11px] font-mono text-gray truncate">
                {btcWallet.address?.slice(0, 6)}...{btcWallet.address?.slice(-4)}
              </code>
              <button
                onClick={() => { navigator.clipboard.writeText(btcWallet.address!); setCopiedBtcAddr(true); setTimeout(() => setCopiedBtcAddr(false), 1500); }}
                className="p-0.5 text-gray/30 hover:text-gray transition-colors cursor-pointer shrink-0" title="Copy address"
              >
                {copiedBtcAddr ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
              </button>
              <button onClick={() => btcWallet.disconnect()} className="p-0.5 text-gray/30 hover:text-red-400 transition-colors cursor-pointer shrink-0" title="Disconnect">
                <LogOut className="w-3 h-3" />
              </button>
            </div>
          ) : (
            <div className="relative flex-1 min-w-0" ref={walletPickerRef}>
              {isMobileNoWallet ? (
                <MobileWalletGuidance />
              ) : (
                <>
                  <button
                    onClick={() => setShowWalletPicker(!showWalletPicker)}
                    disabled={btcWallet.connecting}
                    className="w-full py-2.5 rounded-[10px] font-semibold transition-all flex items-center justify-center gap-2 bg-btc/10 hover:bg-btc/20 text-btc border border-btc/25 disabled:opacity-50 cursor-pointer text-[13px]"
                  >
                    {btcWallet.connecting ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Wallet className="w-3.5 h-3.5" />}
                    Connect BTC Wallet
                    <ChevronDown className={cn("w-3 h-3 transition-transform", showWalletPicker && "rotate-180")} />
                  </button>
                  {showWalletPicker && (
                    <div className="absolute left-0 right-0 top-full mt-1.5 bg-card border border-gray/20 rounded-[12px] shadow-xl z-50 overflow-hidden">
                      <button
                        onClick={() => { btcWallet.connect("sats-connect", networkId); setShowWalletPicker(false); }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-btc/5 transition-colors cursor-pointer border-b border-gray/10"
                      >
                        <div className="w-8 h-8 rounded-full bg-btc/10 flex items-center justify-center">
                          <Wallet className="w-4 h-4 text-btc" />
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-medium text-foreground">Xverse / Leather</div>
                          <div className="text-[10px] text-gray">Sats Connect compatible</div>
                        </div>
                      </button>
                      <button
                        onClick={() => { btcWallet.connect("unisat", networkId); setShowWalletPicker(false); }}
                        className="w-full flex items-center gap-3 px-4 py-3 hover:bg-btc/5 transition-colors cursor-pointer"
                      >
                        <div className="w-8 h-8 rounded-full bg-btc/10 flex items-center justify-center">
                          <Wallet className="w-4 h-4 text-btc" />
                        </div>
                        <div className="text-left">
                          <div className="text-sm font-medium text-foreground">UniSat</div>
                          <div className="text-[10px] text-gray">Browser extension</div>
                        </div>
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Amount + Token selector */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-caption text-gray">Amount</span>
            <span className="text-caption text-gray/50">
              {btcWallet.connected && btcWallet.balance !== null
                ? `Balance: ${(btcWallet.balance / 1e8).toFixed(8)} BTC`
                : btcWallet.connected ? <TextShimmer>Balance: loading…</TextShimmer> : ""}
            </span>
          </div>
          <div className="flex items-center gap-2 p-3 bg-muted border border-gray/15 rounded-[12px] focus-within:border-btc/30 transition-colors">
            <input
              type="number"
              value={btcAmount}
              onChange={(e) => setBtcAmount(e.target.value)}
              placeholder="0.00000000"
              step="0.00000001"
              className="flex-1 bg-transparent text-lg font-mono text-foreground placeholder:text-gray/30 outline-none min-w-0"
            />
            <button onClick={onMax}
              className="px-2 py-1 rounded-[6px] bg-btc/10 border border-btc/20 text-[10px] font-semibold text-btc hover:bg-btc/20 transition-colors cursor-pointer uppercase tracking-wider">
              Max
            </button>
            {tokenSelector}
          </div>
          {btcAmount && (
            <p className="text-[10px] text-gray/50 pl-1">
              {btcAmountSats.toLocaleString()} sats
            </p>
          )}
        </div>

        {/* Recipient stealth address */}
        <StealthRecipientInput
          onResolved={(meta, name) => { setResolvedMeta(meta); setResolvedName(name); }}
          resolvedMeta={resolvedMeta}
          resolvedName={resolvedName}
          error={error}
          onError={setError}
          label="Private destination"
          selfMeta={stealthAddress ?? null}
          defaultToSelf
        />

        {/* Error */}
        {status === "error" && error && (
          <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-[10px]">
            <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
            <span className="text-caption text-red-400">{error}</span>
          </div>
        )}

        {status === "error" && isPolicyRejection(error) && publicKey && (
          <ApplyForAccess actor={publicKey.toBase58()} networkId={networkId} />
        )}

        {/* Permissioned-pool indicator — visible only when config marks pool permissioned */}
        {poolPermissioned && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-muted border border-gray/15">
            <Info className="w-3.5 h-3.5 shrink-0 text-gray" aria-hidden />
            <span className="text-[11px] text-gray">
              Eligibility is checked privately before this deposit is finalized
              on Solana.
            </span>
          </div>
        )}

        {/* Add funds / Preview button */}
        {btcWallet.connected ? (
          <button
            onClick={buildTxPreview}
            disabled={!canSubmitBtc || buildingPreview || btcAmountSats < BTC_DUST_LIMIT || (btcWallet.balance !== null && btcAmountSats > btcWallet.balance)}
            className={cn(
              "w-full flex items-center justify-center gap-2 py-3.5 rounded-[12px]",
              "text-body2 font-semibold transition-all cursor-pointer",
              canSubmitBtc && !buildingPreview
                ? "btn-privacy shadow-[0_0_20px_rgba(255,255,255,0.06)] hover:shadow-[0_0_30px_rgba(255,255,255,0.12)]"
                : "bg-gray/20 text-gray/50 cursor-not-allowed"
            )}
          >
            {buildingPreview ? (<><Loader2 className="w-4 h-4 animate-spin" />Generating...</>) : (<><Shield className="w-4 h-4" />Add BTC privately</>)}
          </button>
        ) : (
          <button
            disabled
            className="w-full flex items-center justify-center gap-2 py-3.5 rounded-[12px] text-body2 font-semibold bg-gray/20 text-gray/50 cursor-not-allowed"
          >
            <Shield className="w-4 h-4" />
            Add BTC privately
          </button>
        )}
      </div>
    );
  }

  // Passkey user selected SPL token but no wallet connected — prompt to connect
  if (isPasskeyOnly && !selectedToken.isBtcNative) {
    return (
      <div className={cn("space-y-5", className)}>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <span className="text-caption text-gray">Asset</span>
          </div>
          {tokenSelector}
        </div>
        <div className="flex flex-col items-center py-8 space-y-4">
          <div className="w-14 h-14 rounded-full bg-sol/10 border border-sol/20 flex items-center justify-center">
            <Image src={selectedToken.logo} alt={selectedToken.symbol} width={28} height={28} className="rounded-full" />
          </div>
          <div className="text-center space-y-1">
            <p className="text-body2-semibold text-foreground">Connect wallet to add {selectedToken.symbol}</p>
            <p className="text-caption text-gray max-w-[280px]">
              Shielding {selectedToken.symbol} requires a Solana wallet to sign the shield transaction. After that, private transfers can use your passkey.
            </p>
          </div>
          <button
            onClick={() => openWalletModal(true)}
            className={cn(
              "inline-flex items-center gap-2 px-6 py-3 rounded-full",
              "bg-sol hover:bg-sol/80 text-background font-semibold",
              "transition-all cursor-pointer hover:shadow-[0_0_20px_rgba(153,69,255,0.2)]"
            )}
          >
            <Shield className="w-4 h-4" />
            Connect wallet
          </button>
          <p className="text-[10px] text-gray/40">
            Or select BTC for passkey-only funding
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className={cn("space-y-5", className)}>
      {/* Connected wallet bar */}
      {publicKey && (
        <div className="flex items-center justify-between px-1">
          <div className="flex items-center gap-1.5">
            <Wallet className="w-3 h-3 text-sol" />
            <code className="text-[11px] font-mono text-gray">{publicKey.toBase58().slice(0, 4)}...{publicKey.toBase58().slice(-4)}</code>
            <button
              onClick={() => {
                navigator.clipboard.writeText(publicKey.toBase58());
                setCopiedAddr(true);
                setTimeout(() => setCopiedAddr(false), 1500);
              }}
              className="p-0.5 text-gray/30 hover:text-gray transition-colors cursor-pointer"
              title="Copy address"
            >
              {copiedAddr ? <Check className="w-3 h-3 text-green-400" /> : <Copy className="w-3 h-3" />}
            </button>
          </div>
          <button
            onClick={() => wallet.disconnect()}
            className="flex items-center gap-1 text-[11px] text-gray/50 hover:text-red-400 transition-colors cursor-pointer"
          >
            <LogOut className="w-3 h-3" />
            Disconnect
          </button>
        </div>
      )}

      {/* Amount + Token selector */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-caption text-gray">Amount</span>
          <span className="text-caption text-gray/50">
            {selectedToken.isSOL && solBalance !== null
              ? `Public balance: ${(solBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`
              : splBalance !== null
                ? `Public balance: ${(splBalance / (10 ** selectedToken.decimals)).toLocaleString(undefined, { maximumFractionDigits: selectedToken.decimals })} ${selectedToken.symbol}`
                : publicKey
                  ? <TextShimmer>Public balance: loading…</TextShimmer>
                  : "Public balance: Connect wallet"
            }
          </span>
        </div>
        <div className="flex items-center gap-2 p-3 bg-muted border border-gray/15 rounded-[12px] focus-within:border-privacy/30 transition-colors">
          <input
            type="number"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0.00"
            className="flex-1 bg-transparent text-lg font-mono text-foreground placeholder:text-gray/30 outline-none min-w-0"
          />
          <button
            onClick={onMax}
            className="px-2 py-1 rounded-[6px] bg-privacy/10 border border-privacy/20 text-[10px] font-semibold text-privacy hover:bg-privacy/20 transition-colors cursor-pointer uppercase tracking-wider"
          >
            Max
          </button>
          {tokenSelector}
        </div>
        {showSplTestFunds && splFaucetToken && publicKey && (
          <SplTestFundsHelper
            token={splFaucetToken}
            networkId={networkId}
            recipient={publicKey.toBase58()}
            onBalanceRefresh={refreshBalance}
          />
        )}
        {showSolTestFunds && <SolTestFundsHelper />}
        {amountRaw > 0n && poolFees.fees && (
          <div className="space-y-2 border-t border-gray/10 pt-3 text-xs">
            <PreviewRow label="You shield" value={`${formatBaseUnits(amountRaw)} ${displayUnit}`} />
            <PreviewRow label="Shield fee" value={`${formatBaseUnits(depositFee)} ${displayUnit}`} />
            <PreviewRow label="Private balance receives" value={`${formatBaseUnits(privateReceives)} ${privateUnit}`} strong />
            <p className="flex items-start gap-1.5 text-[11px] text-gray/60">
              <Info className="mt-0.5 h-3 w-3 shrink-0" />
              This shield transaction is public. Your later private transfers are not publicly linked by the app.
            </p>
            {highDepositFee && <p className="text-[11px] text-warning">The fee is high relative to this shield amount.</p>}
          </div>
        )}
      </div>

      {/* Recipient stealth address */}
      <StealthRecipientInput
        onResolved={(meta, name) => { setResolvedMeta(meta); setResolvedName(name); }}
        resolvedMeta={resolvedMeta}
        resolvedName={resolvedName}
        error={error}
        onError={setError}
        label="Private destination"
        selfMeta={stealthAddress ?? null}
        defaultToSelf
      />

      {/* Error */}
      {status === "error" && error && (
        <div className="flex items-center gap-2 p-3 bg-red-500/10 border border-red-500/20 rounded-[10px]">
          <AlertCircle className="w-4 h-4 text-red-400 shrink-0" />
          <span className="text-caption text-red-400">{error}</span>
        </div>
      )}

      {status === "error" && isPolicyRejection(error) && publicKey && (
        <ApplyForAccess actor={publicKey.toBase58()} networkId={networkId} />
      )}

      {status === "unknown" && txSig && (
        <div className="space-y-2 rounded-[10px] border border-warning/25 bg-warning/5 p-3 text-caption">
          <div className="flex items-start gap-2 text-warning">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{error}</span>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={checkDepositAgain} className="inline-flex min-h-11 items-center gap-1.5 rounded-lg bg-foreground px-3 text-xs font-semibold text-background">
              <RefreshCw className="h-3.5 w-3.5" /> Check again
            </button>
            <a href={getSolanaExplorerTxUrl(txSig, networkId)} target="_blank" rel="noreferrer" className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-gray/15 px-3 text-xs font-semibold">
              Explorer <ExternalLink className="h-3.5 w-3.5" />
            </a>
          </div>
        </div>
      )}

      {status === "processing" && txSig && (
        <div className="flex items-center gap-2 rounded-[10px] border border-gray/15 bg-muted px-3 py-2.5 text-caption text-gray-light">
          <Loader2 className="h-4 w-4 shrink-0 animate-spin" />
          <span><strong className="text-foreground">Submitted.</strong> Confirming on-chain…</span>
        </div>
      )}

      {/* Permissioned-pool indicator — visible only when config marks pool permissioned */}
      {poolPermissioned && (
        <div className="flex items-center gap-2 px-3 py-2 rounded-[10px] bg-muted border border-gray/15">
          <Info className="w-3.5 h-3.5 shrink-0 text-gray" aria-hidden />
          <span className="text-[11px] text-gray">
            Policy is checked privately before your wallet signs. Asset state
            and finality remain on Solana.
          </span>
        </div>
      )}

      {policyMessage && status === "processing" && (
        <div
          className="flex items-center gap-2 rounded-[10px] border border-privacy/20 bg-privacy/5 px-3 py-2 text-[11px] text-gray-light"
          role="status"
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin text-privacy" />
          {policyMessage}
        </div>
      )}

      {/* Add funds button */}
      <button
        onClick={handleShield}
        disabled={!canSubmit || status === "processing"}
        className={cn(
          "w-full flex items-center justify-center gap-2 py-3.5 rounded-[12px]",
          "text-body2 font-semibold transition-all cursor-pointer",
          canSubmit && status !== "processing"
            ? "btn-privacy shadow-[0_0_20px_rgba(255,255,255,0.06)] hover:shadow-[0_0_30px_rgba(255,255,255,0.12)]"
            : "bg-gray/20 text-gray/50 cursor-not-allowed"
        )}
      >
        {status === "processing" ? (
          <>
            <Loader2 className="w-4 h-4 animate-spin" />
            Adding...
          </>
        ) : (
          <>
            <Shield className="w-4 h-4" />
            Add {selectedToken.symbol} privately
          </>
        )}
      </button>
    </div>
  );
}

function PreviewRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className="text-gray/70">{label}</span>
      <span className={cn("font-mono text-right", strong && "font-semibold text-foreground")}>{value}</span>
    </div>
  );
}
