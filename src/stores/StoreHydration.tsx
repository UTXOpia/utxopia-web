"use client";

import { useEffect, useRef, useCallback, type JSX } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getPendingFaucetActivities } from "@/lib/faucet-activity";
import type { NetworkId } from "@/lib/network-config";
import type { VaultId } from "@/lib/vault-config";
import { publishVaultScan, readVaultScan, vaultScanKey } from "@/lib/vault-scan-cache";
import { useBitcoinWalletStore } from "./bitcoin-wallet-store";
import { useUTXOpiaStore } from "./utxopia-store";

/** Right after the member's own deposit, send or claim. */
const ACTING_MS = 5_000;
/** A BTC deposit is in flight — minutes of travel, so a middle gear. */
const PENDING_BTC_MS = 15_000;
const IDLE_MS = 60_000;
/** How long a pending BTC deposit counts as an active wait. */
const BTC_WINDOW_MS = 20 * 60_000;

/** Hand the vault being left to the scan cache, before clearKeys drops it. */
function stashActiveScan(envIdentity: string): void {
  const [networkId, vaultId] = envIdentity.split(":") as [NetworkId, VaultId];
  const { inboxNotes, inboxBalancesByToken, inboxHasLoaded, stealthAddressEncoded } =
    useUTXOpiaStore.getState();
  if (!inboxHasLoaded || !stealthAddressEncoded) return;
  publishVaultScan(vaultScanKey(networkId, vaultId), {
    status: "ready",
    owner: stealthAddressEncoded,
    balancesByToken: inboxBalancesByToken,
    // Tag the notes with the vault they came from: views that read a note's
    // vault fall back to the active one, which after the switch is the wrong one.
    notes: inboxNotes.map((note) => ({ ...note, vaultId })),
    fetchedAt: Date.now(),
  });
}

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
  const { networkId, vaultId, config: networkConfig } = useChainEnvironment();
  const stealthAddress = useUTXOpiaStore((s) => s.stealthAddressEncoded);
  // Subscribed, not read through getState(): opening the window has to rebuild
  // the pending timer, or a deposit still waits out the minute that was already
  // scheduled before switching to the fast gear.
  const fastRefreshUntil = useUTXOpiaStore((s) => s.fastRefreshUntil);
  const envIdentity = `${networkId}:${vaultId}`;
  const lastEnvIdentityRef = useRef(envIdentity);
  const clearKeys = useUTXOpiaStore((s) => s.clearKeys);
  const rescopeVaultSeed = useUTXOpiaStore((s) => s.rescopeVaultSeed);
  const setIdentityRestoring = useUTXOpiaStore((s) => s.setIdentityRestoring);
  useEffect(() => {
    const previous = lastEnvIdentityRef.current;
    if (previous !== envIdentity) {
      lastEnvIdentityRef.current = envIdentity;
      hasHydratedRef.current = false;
      hasPasskeyHydratedRef.current = false;
      // The vault being left was just scanned; the vault being entered was too,
      // by the sibling hook. Trade them through the scan cache instead of
      // dropping both — clearKeys is about to wipe this one, and without the
      // hand-off the switch pays for two full re-scans to end up where it
      // already was.
      stashActiveScan(previous);
      // Flag the gap: for the few frames between dropping the old keys and
      // restoring the new ones the store looks signed out, and the vault would
      // otherwise swap the balance for the "Create private vault" hero mid-switch.
      setIdentityRestoring(true);
      clearKeys(undefined, { keepSession: true });
      // An envelope member carries one root that covers every scope, so the new
      // pool's identity is a derivation away rather than another Face ID. Falls
      // through to the passkey hydration below when there is no root — a
      // legacy identity, or a session that never unlocked one.
      void rescopeVaultSeed().then((rescoped) => {
        if (!rescoped) return;
        // Now that the new identity is derived, the cached scan can be checked
        // against it and adopted; the revalidating fetch repaints in place.
        const cached = readVaultScan(networkId, vaultId);
        if (cached?.status === "ready") {
          useUTXOpiaStore.getState().adoptVaultScan(cached);
        }
        setIdentityRestoring(false);
      });
    }
  }, [envIdentity, networkId, vaultId, clearKeys, rescopeVaultSeed, setIdentityRestoring]);

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

  // Auto-refresh balances when keys are available and the page is visible.
  const refreshAll = useCallback(() => {
    if (!hasAnyKeys) return;
    refreshInbox();
    if (walletPubkey) refreshPublicBalance(walletPubkey);
  }, [hasAnyKeys, refreshInbox, walletPubkey, refreshPublicBalance]);

  // The cadence is adaptive rather than a flat minute. Idle stays at 60s: a
  // faster floor buys nothing, because every tick re-reads the whole
  // announcement feed and the sibling vault re-decrypts it. The two cases worth
  // paying for are both "the member is waiting for something they just did".
  const nextDelayMs = useCallback(() => {
    if (document.hidden) return IDLE_MS;
    if (Date.now() < fastRefreshUntil) return ACTING_MS;
    // The faucet ledger holds entries for an hour; only the first minutes of a
    // BTC deposit are a wait worth polling hard for.
    const waitingOnBtc = getPendingFaucetActivities({
      networkId,
      stealthAddress,
      currentPoolAddress: networkConfig.bitcoin.poolAddress,
    }).some((activity) => Date.now() - activity.createdAt < BTC_WINDOW_MS);
    return waitingOnBtc ? PENDING_BTC_MS : IDLE_MS;
  }, [fastRefreshUntil, networkId, stealthAddress, networkConfig.bitcoin.poolAddress]);

  useEffect(() => {
    if (!hasAnyKeys) return;

    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    // Self-scheduling rather than setInterval: the delay is recomputed after
    // every tick, so a window opening or closing takes effect immediately.
    const schedule = () => {
      if (cancelled) return;
      timer = setTimeout(() => {
        if (!document.hidden) refreshAll();
        schedule();
      }, nextDelayMs());
    };
    schedule();

    // Also refresh when tab becomes visible after being hidden
    const onVisibility = () => {
      if (!document.hidden) refreshAll();
    };
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [hasAnyKeys, refreshAll, nextDelayMs]);

  return <></>;
}
