"use client";

import { useState, useCallback, useRef } from "react";
import {
  bytesToHex,
  buildDepositPsbt,
  UTXOpiaClient,
} from "@utxopia/sdk";
import type { StealthMetaAddress } from "@utxopia/sdk";
import { useBitcoinWalletStore, type WalletUtxo } from "@/stores/bitcoin-wallet-store";
import { useNotesStore } from "@/stores/notes-store";
import { registerDeposit } from "@/lib/api/deposits";
import { prepareTweakDeposit } from "@/lib/tweak-deposit";
import { getBtcSignerNetwork } from "@/lib/btc-network";
import { notifyError } from "@/lib/notifications";
import { BTC_DUST_LIMIT } from "@/lib/btc-constants";
import { useChainEnvironment } from "@/lib/chain-environment";

export interface DepositPreview {
  depositAddress: string;
  depositAmountSats: number;
  npk: Uint8Array;
  ephemeralPub: Uint8Array;
  cachedUtxos: WalletUtxo[];
}

export interface WalletDepositResult {
  txid: string;
  depositAddress: string;
  /** Local notes-store id for this deposit — how the status tracker finds it. */
  noteId: string;
}

interface UseBtcDepositParams {
  resolvedMeta: StealthMetaAddress | null;
  onStatusChange: (status: "done" | "error") => void;
  onError: (msg: string) => void;
}

export function useBtcDeposit({
  resolvedMeta,
  onStatusChange,
  onError,
}: UseBtcDepositParams) {
  const btcWallet = useBitcoinWalletStore();
  const { networkId, config: networkConfig } = useChainEnvironment();

  const [btcAmount, setBtcAmount] = useState("");
  const [walletDepositing, setWalletDepositing] = useState(false);
  const [walletDepositResult, setWalletDepositResult] = useState<WalletDepositResult | null>(null);
  const [depositPreview, setDepositPreview] = useState<DepositPreview | null>(null);
  const [buildingPreview, setBuildingPreview] = useState(false);
  const [selectedUtxoKeys, setSelectedUtxoKeys] = useState<Set<string>>(new Set());
  const [showUtxoList, setShowUtxoList] = useState(false);
  const [editingUtxos, setEditingUtxos] = useState(false);
  const [showNoteKeys, setShowNoteKeys] = useState(false);
  const [copiedBtcAddr, setCopiedBtcAddr] = useState(false);
  const [showWalletPicker, setShowWalletPicker] = useState(false);
  const walletPickerRef = useRef<HTMLDivElement>(null);

  // ── BTC: Reset flow ──
  const resetBtcFlow = useCallback(() => {
    onError("");
    setBtcAmount("");
    setWalletDepositResult(null);
    setDepositPreview(null);
  }, [onError]);

  // ── BTC: Build PSBT preview ──
  const buildTxPreview = useCallback(async () => {
    if (!resolvedMeta || !btcWallet.connected) return;
    const amountSats = Math.floor(parseFloat(btcAmount || "0") * 1e8);
    if (!amountSats || amountSats < BTC_DUST_LIMIT) {
      notifyError(`Amount must be at least ${BTC_DUST_LIMIT} sats`);
      return;
    }

    setBuildingPreview(true);
    onError("");
    setDepositPreview(null);

    try {
      const client = UTXOpiaClient.instance();
      // The deposit address binds the note keys through its tapleaf, so the
      // transaction is a plain payment. Self-deposit only: the ephemeral key is
      // indexed off this wallet's viewing key, and only that key can rebuild the
      // leaf to recover the coins.
      const [deposit, utxos] = await Promise.all([
        prepareTweakDeposit(networkConfig, resolvedMeta),
        btcWallet.getPaymentUtxos(networkId),
      ]);

      if (utxos.length === 0) throw new Error("No confirmed UTXOs available in wallet");

      const autoSelected = client.selectUtxos(
        utxos.map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, scriptPubkeyHex: u.scriptPubkeyHex })),
        amountSats,
        2,
      );
      setSelectedUtxoKeys(new Set(autoSelected.map((u) => `${u.txid}:${u.vout}`)));
      setShowUtxoList(false);
      setEditingUtxos(false);

      setDepositPreview({
        depositAddress: deposit.btcAddress,
        depositAmountSats: amountSats,
        npk: deposit.npk,
        ephemeralPub: deposit.ephemeralPub,
        cachedUtxos: utxos,
      });
    } catch (err) {
      onError(err instanceof Error ? err.message : "Failed to generate deposit");
    } finally {
      setBuildingPreview(false);
    }
  }, [resolvedMeta, btcAmount, btcWallet, networkConfig, networkId, onError]);

  // ── BTC: Confirm & sign PSBT ──
  const confirmAndSign = useCallback(async () => {
    if (!depositPreview) return;
    setWalletDepositing(true);
    onError("");

    try {
      const selected = depositPreview.cachedUtxos
        .filter((u) => selectedUtxoKeys.has(`${u.txid}:${u.vout}`))
        .map((u) => ({ txid: u.txid, vout: u.vout, value: u.value, scriptPubkeyHex: u.scriptPubkeyHex }));
      if (selected.length === 0) throw new Error("No UTXOs selected");

      const totalSelected = selected.reduce((sum, u) => sum + u.value, 0);
      if (totalSelected < depositPreview.depositAmountSats)
        throw new Error(`Selected UTXOs (${totalSelected} sats) insufficient for deposit (${depositPreview.depositAmountSats} sats)`);

      const psbtResult = buildDepositPsbt({
        senderUtxos: selected,
        depositAddress: depositPreview.depositAddress,
        depositAmountSats: depositPreview.depositAmountSats,
        changeAddress: btcWallet.address!,
        feeRate: 2,
        network: getBtcSignerNetwork(networkId),
      });

      // Register before broadcasting, not after. Nothing on chain identifies the
      // deposit, so the tracker's only way to find it is polling addresses it was
      // told about — and coins at an unregistered address are coins nobody is
      // watching, with no refund path yet.
      let depositId: string | undefined;
      try {
        const res = await registerDeposit(
          depositPreview.depositAddress,
          bytesToHex(depositPreview.npk),
          depositPreview.depositAmountSats,
          bytesToHex(depositPreview.ephemeralPub),
          networkId,
          "tweak",
        );
        depositId = res.deposit_id;
      } catch (e) {
        onError(
          `Not sending: the deposit could not be registered, and an unregistered ` +
            `address is one nobody is watching. ${e instanceof Error ? e.message : String(e)}`,
        );
        return;
      }

      const { txid } = await btcWallet.signAndBroadcastPsbt(psbtResult.psbtBase64, networkId);

      // The status tracker reads `depositId` off the note, so it has to be the
      // id the registration above returned — without it the tracker renders
      // nothing for a deposit that is being tracked perfectly well.
      const noteId = useNotesStore.getState().saveNote({
        commitment: bytesToHex(depositPreview.npk),
        noteExport: txid,
        amountSats: depositPreview.depositAmountSats,
        taprootAddress: depositPreview.depositAddress,
        depositId,
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      });

      setWalletDepositResult({ txid, depositAddress: depositPreview.depositAddress, noteId });
      setDepositPreview(null);
      btcWallet.refreshBalance(networkId);
      onStatusChange("done");
    } catch (err) {
      onError(err instanceof Error ? err.message : "Wallet deposit failed");
      onStatusChange("error");
    } finally {
      setWalletDepositing(false);
    }
  }, [depositPreview, selectedUtxoKeys, btcWallet, networkId, onStatusChange, onError]);

  return {
    btcWallet,
    btcAmount,
    setBtcAmount,
    walletDepositing,
    walletDepositResult,
    setWalletDepositResult,
    depositPreview,
    setDepositPreview,
    buildingPreview,
    selectedUtxoKeys,
    setSelectedUtxoKeys,
    showUtxoList,
    setShowUtxoList,
    editingUtxos,
    setEditingUtxos,
    showNoteKeys,
    setShowNoteKeys,
    copiedBtcAddr,
    setCopiedBtcAddr,
    showWalletPicker,
    setShowWalletPicker,
    walletPickerRef,
    resetBtcFlow,
    buildTxPreview,
    confirmAndSign,
  };
}

export type BtcDepositState = ReturnType<typeof useBtcDeposit>;
