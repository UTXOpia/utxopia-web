"use client";

import { useEffect, useRef, useCallback, type JSX } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useChainEnvironment } from "@/lib/chain-environment";
import { useBitcoinWalletStore } from "./bitcoin-wallet-store";
import { useUTXOpiaStore } from "./utxopia-store";

/**
 * Component to hydrate Zustand stores on mount.
 * Handles localStorage restoration, Poseidon initialization,
 * and auto-hydration of UTXOpia keys from localStorage on wallet connect.
 */
export function StoreHydration(): JSX.Element {
  const hydrateBtcWallet = useBitcoinWalletStore((s) => s._hydrate);
  const initPoseidon = useUTXOpiaStore((s) => s.initPoseidon);
  const keys = useUTXOpiaStore((s) => s.keys);
  const viewOnlyKeys = useUTXOpiaStore((s) => s.viewOnlyKeys);
  const hasAnyKeys = !!(keys || viewOnlyKeys);
  const isPoseidonReady = useUTXOpiaStore((s) => s.isPoseidonReady);
  const hydrateKeys = useUTXOpiaStore((s) => s.hydrateKeys);
  const hydratePasskeyKeys = useUTXOpiaStore((s) => s.hydratePasskeyKeys);
  const inboxLoading = useUTXOpiaStore((s) => s.inboxLoading);
  const inboxNotesLength = useUTXOpiaStore((s) => s.inboxNotes.length);
  const refreshInbox = useUTXOpiaStore((s) => s.refreshInbox);

  const refreshPublicBalance = useUTXOpiaStore((s) => s.refreshPublicBalance);
  const { publicKey: walletPubkey } = useWallet();

  // Track if we've already triggered a refresh
  const hasRefreshedRef = useRef(false);
  const hasHydratedRef = useRef(false);
  const hasPasskeyHydratedRef = useRef(false);

  // Switching vault switches private identity. Drop the old keys and re-arm
  // hydration so the vault warmed at unlock restores silently.
  //
  // This lives here, in the globally-mounted hydrator, because it used to live
  // on /vault — and the switch does not happen there. `VaultDestinationPicker`
  // switches from /vault/deposit, where nothing reset the keys, so the store
  // kept serving the *previous* vault's stealth address while the URL, the
  // pool and the deposit all said the new one. The deposit then landed in the
  // right pool encrypted to the wrong identity: unspendable from either vault
  // view, and invisible in both, because each view scans only its own pool.
  const { networkId, vaultId } = useChainEnvironment();
  const envIdentity = `${networkId}:${vaultId}`;
  const lastEnvIdentityRef = useRef(envIdentity);
  const clearKeys = useUTXOpiaStore((s) => s.clearKeys);
  const setIdentityRestoring = useUTXOpiaStore((s) => s.setIdentityRestoring);
  useEffect(() => {
    if (lastEnvIdentityRef.current !== envIdentity) {
      lastEnvIdentityRef.current = envIdentity;
      hasHydratedRef.current = false;
      hasPasskeyHydratedRef.current = false;
      // Flag the gap: for the few frames between dropping the old keys and
      // restoring the new ones the store looks signed out, and the vault would
      // otherwise swap the balance for the "Create private vault" hero mid-switch.
      setIdentityRestoring(true);
      clearKeys(undefined, { keepSession: true });
    }
  }, [envIdentity, clearKeys, setIdentityRestoring]);

  useEffect(() => {
    if (hasAnyKeys) setIdentityRestoring(false);
  }, [hasAnyKeys, setIdentityRestoring]);

  useEffect(() => {
    // Hydrate Bitcoin wallet from localStorage
    hydrateBtcWallet();

    // Initialize Poseidon for cryptographic operations
    initPoseidon();
  }, [hydrateBtcWallet, initPoseidon]);

  // Auto-hydrate UTXOpia keys from localStorage when wallet connects
  useEffect(() => {
    if (walletPubkey && isPoseidonReady && !keys && !hasHydratedRef.current) {
      hasHydratedRef.current = true;
      void hydrateKeys(walletPubkey).finally(() => setIdentityRestoring(false));
    }
  }, [walletPubkey, isPoseidonReady, keys, hydrateKeys, envIdentity, setIdentityRestoring]);

  // Auto-hydrate passkey keys for the active chain. Runs independently of the
  // wallet (a passkey user may also have a Solana wallet auto-connected — the
  // old `!walletPubkey` gate blocked passkey restore in that case, bouncing them
  // back to sign-in on the Solana side). Per-chain so switching chains re-restores.
  useEffect(() => {
    if (isPoseidonReady && !keys && !hasPasskeyHydratedRef.current) {
      hasPasskeyHydratedRef.current = true;
      void hydratePasskeyKeys().finally(() => setIdentityRestoring(false));
    }
  }, [isPoseidonReady, keys, hydratePasskeyKeys, envIdentity, setIdentityRestoring]);

  // Reset hydration flag when wallet disconnects
  useEffect(() => {
    if (!walletPubkey) {
      hasHydratedRef.current = false;
    }
  }, [walletPubkey]);

  // One wallet-scoped public balance request. Keeping this in the singleton
  // hydration component avoids duplicate requests from every useUTXOpia caller.
  useEffect(() => {
    if (walletPubkey) refreshPublicBalance(walletPubkey);
  }, [walletPubkey, refreshPublicBalance]);

  // Auto-refresh inbox when keys become available (ONCE per session)
  // Covers both full keys (wallet login) and viewOnlyKeys (view-only paste)
  useEffect(() => {
    if (hasAnyKeys && !inboxLoading && inboxNotesLength === 0 && !hasRefreshedRef.current) {
      hasRefreshedRef.current = true;
      refreshInbox();
    }
  }, [hasAnyKeys, inboxLoading, inboxNotesLength, refreshInbox]);

  // Reset refresh flag when keys are cleared (user disconnects)
  useEffect(() => {
    if (!hasAnyKeys) {
      hasRefreshedRef.current = false;
    }
  }, [hasAnyKeys]);

  // Auto-refresh balances every 60s when keys are available and page is visible
  const refreshAll = useCallback(() => {
    if (!hasAnyKeys) return;
    refreshInbox();
    if (walletPubkey) refreshPublicBalance(walletPubkey);
  }, [hasAnyKeys, refreshInbox, walletPubkey, refreshPublicBalance]);

  useEffect(() => {
    if (!hasAnyKeys) return;

    const interval = setInterval(() => {
      if (!document.hidden) refreshAll();
    }, 60_000);

    // Also refresh when tab becomes visible after being hidden
    const onVisibility = () => {
      if (!document.hidden) refreshAll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      clearInterval(interval);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasAnyKeys, refreshAll]);

  return <></>;
}
