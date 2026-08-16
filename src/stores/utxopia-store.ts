"use client";

import { create } from "zustand";
import { PublicKey, type Connection } from "@solana/web3.js";
import {
  buildRecoveryString,
  clearDeviceEnvelope,
  createVault,
  unlockWithDevice,
  unlockWithRecoveryString,
  type VaultScope,
} from "@/lib/vault-identity";
import {
  UTXOpiaClient,
  hexToBytes,
  bytesToHex,
  deserializeKeysFromStorage,
  deriveChainScopedPasskeySeed,
  passkeyStorageOwner as sdkPasskeyStorageOwner,
  scanUnifiedNotes,
  scanAnnouncementsViewOnly,
  decodeViewOnlyKeys,
  type UTXOpiaKeys,
  type StealthMetaAddress,
  type ViewOnlyKeys,
  type ScannedNote,
  type ViewOnlyScannedNote,
} from "@utxopia/sdk";
import { fetchSpentNullifierPDAs, nullifierHashToPDA } from "@/lib/nullifier-utils";
import { API_ENDPOINTS } from "@/lib/api/constants";
import { detectNetwork, networkChain, type NetworkId } from "@/lib/network-config";
import {
  detectVault,
  ensureChainEnvironment,
  getChainEnvironment,
} from "@/lib/chain-environment";
import type { VaultId } from "@/lib/vault-config";
import { fetchInboxSource, getEventClient, planTokenScan, resetEventClient, scanByTokenPlan } from "@/lib/chain-inbox";
import { deriveNameOwnerKeypair } from "@/lib/names/passkey-solana-key";
import { parseVaultBackupFile } from "@/lib/vault-backup";
import { getAlphaDemoInboxNotes } from "@/lib/alpha-demo-ledger";

// ============================================================================
// localStorage Key Persistence (AES-256-GCM encrypted)
// ============================================================================

const KEYS_STORAGE_PREFIX = "utxo:keys:";

// Derive the AES-GCM storage key from a REAL per-user secret (a wallet signature,
// the auth signature, or the passkey seed) plus the public owner id for domain
// separation. Without the secret, localStorage ciphertext is not decryptable by
// anyone who merely reads the browser profile.
async function deriveStorageKey(owner: string, secret: Uint8Array): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const ownerBytes = enc.encode(":utxopia-storage-key:v5:" + owner);
  const material = new Uint8Array(secret.length + ownerBytes.length);
  material.set(secret, 0);
  material.set(ownerBytes, secret.length);
  const keyMaterial = await crypto.subtle.importKey("raw", material, "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: enc.encode("utxopia-storage-salt:v5:" + owner), iterations: 600_000, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

// In-memory per-session cache: derived once at auth (unlock), reused for the rest
// of the session. A fresh page load has an empty cache, so persisted keys can only
// be decrypted after the user re-authenticates once (the "once per session" model).
// Keyed per storage owner so one unlock ceremony can warm both vault identities
// and switching vaults hydrates without a second prompt.
const sessionStorageKeys = new Map<string, CryptoKey>();

async function unlockStorageKey(owner: string, secret: Uint8Array): Promise<CryptoKey> {
  const key = await deriveStorageKey(owner, secret);
  sessionStorageKeys.set(owner, key);
  return key;
}

function cachedStorageKey(owner: string): CryptoKey | null {
  return sessionStorageKeys.get(owner) ?? null;
}

async function encryptData(key: CryptoKey, plaintext: string): Promise<string> {
  const enc = new TextEncoder();
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plaintext),
  );
  // Store as iv(24 hex) + ciphertext(hex)
  return bytesToHex(iv) + bytesToHex(new Uint8Array(ciphertext));
}

async function decryptData(key: CryptoKey, encrypted: string): Promise<string> {
  const ivHex = encrypted.slice(0, 24);
  const ctHex = encrypted.slice(24);
  const iv = hexToBytes(ivHex);
  const ciphertext = hexToBytes(ctHex);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: iv as BufferSource },
    key,
    ciphertext as BufferSource,
  );
  return new TextDecoder().decode(plaintext);
}

// Persist at auth time: `secret` unlocks (derives + caches) the session storage key.
async function persistKeys(walletPubkey: string, secret: Uint8Array): Promise<void> {
  try {
    const client = UTXOpiaClient.instance();
    const data = client.serializeKeys();
    if (!data) return;
    const storageKey = await unlockStorageKey(walletPubkey, secret);
    const encrypted = await encryptData(storageKey, JSON.stringify(data));
    localStorage.setItem(KEYS_STORAGE_PREFIX + walletPubkey, encrypted);
  } catch {
    // localStorage or Web Crypto may be unavailable
  }
}

// Decrypt only with the in-session unlocked key. Returns null on a fresh session
// (no cached key) so hydration cannot transparently decrypt without re-auth.
async function loadKeys(walletPubkey: string, solanaPublicKey: Uint8Array): Promise<UTXOpiaKeys | null> {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE_PREFIX + walletPubkey);
    if (!raw) return null;
    const storageKey = cachedStorageKey(walletPubkey);
    if (!storageKey) return null;

    const decrypted = await decryptData(storageKey, raw);
    const data = JSON.parse(decrypted);

    return deserializeKeysFromStorage(data, solanaPublicKey);
  } catch {
    return null;
  }
}

// Per-chain storage owner id for a passkey identity (so each chain's encrypted
// keys live under their own localStorage key).
function passkeyStorageOwner(
  credentialId: string,
  networkId: NetworkId,
  vaultId: VaultId,
): string {
  const scopedCredential = vaultId === "open"
    ? credentialId
    : `${credentialId}:vault:${vaultId}`;
  return sdkPasskeyStorageOwner(scopedCredential, {
    chain: networkChain(networkId),
    network: networkId,
  });
}

async function chainScopedPasskeySeed(
  seed: Uint8Array,
  networkId: NetworkId,
  vaultId: VaultId,
): Promise<Uint8Array> {
  const chainSeed = deriveChainScopedPasskeySeed(seed, {
    chain: networkChain(networkId),
    network: networkId,
  });
  if (vaultId === "open") return chainSeed;
  const domain = new TextEncoder().encode(`utxopia:vault-identity:v1:${vaultId}`);
  const material = new Uint8Array(chainSeed.length + domain.length);
  material.set(chainSeed);
  material.set(domain, chainSeed.length);
  return new Uint8Array(await crypto.subtle.digest("SHA-256", material));
}

/** Scope + address deriver for the envelope layer, bound to the active chain. */
async function envelopeContext(): Promise<{
  scope: VaultScope;
  metaAddressFor: (seed: Uint8Array) => Promise<string>;
}> {
  const env = await ensureChainEnvironment();
  return {
    scope: { networkId: env.networkId, vaultId: env.vaultId },
    metaAddressFor: async (seed) => {
      const { stealthAddressEncoded } = await UTXOpiaClient.instance().loginWithSeed(seed);
      if (!stealthAddressEncoded) throw new Error("Could not derive a vault address from this seed.");
      return stealthAddressEncoded;
    },
  };
}

/** The seed is already loaded into the client by metaAddressFor; publish it. */
async function adoptSeedIntoSession(
  set: (partial: Partial<UTXOpiaState>) => void,
  seed: Uint8Array,
): Promise<void> {
  const client = UTXOpiaClient.instance();
  set({
    keys: client.keys ?? null,
    viewOnlyKeys: null,
    isViewOnly: false,
    stealthAddress: client.stealthAddress ?? null,
    stealthAddressEncoded: client.stealthAddressEncoded ?? null,
    vaultSeed: seed,
    hasKeys: true,
    isLoading: false,
    error: null,
  });
}

function walletStorageOwner(walletPubkey: string, vaultId: VaultId): string {
  return vaultId === "open" ? walletPubkey : `${walletPubkey}:vault:${vaultId}`;
}

/** Decrypt a vault identity's keys from the in-session warm cache (no passkey
 *  prompt). Returns null when that vault was never unlocked this session —
 *  callers must treat that as "locked", not as an error. Passkey flow only:
 *  wallet identities warm no sibling. */
export async function loadWarmVaultKeys(
  networkId: NetworkId,
  vaultId: VaultId,
): Promise<UTXOpiaKeys | null> {
  if (typeof window === "undefined") return null;
  const credentialId = localStorage.getItem("utxo:passkey_credential_id") || "default";
  return loadKeys(passkeyStorageOwner(credentialId, networkId, vaultId), new Uint8Array(32));
}

function removeKeys(walletPubkey: string): void {
  try {
    localStorage.removeItem(KEYS_STORAGE_PREFIX + walletPubkey);
  } catch {
    // ignore
  }
}

// Module-level deduplication for inbox fetch
let inboxFetchPromise: Promise<void> | null = null;

// Highest announcement leafIndex already decrypted for the current inbox
// identity. Announcements are append-only, so a poll only fetches and scans
// what landed above this — previously scanned notes are carried forward.
// ponytail: a leaf backfilled below the mark (indexer 429 gap) is only picked
// up by a force refresh, which resets this to -1.
let lastScannedLeafIndex = -1;
let lastInboxIdentity = "";

// ============================================================================
// Types
// ============================================================================

export interface InboxNote {
  amount: bigint;
  ephemeralPub: Uint8Array;
  leafIndex: number;
  commitment: Uint8Array;
  stealthPub?: { x: bigint; y: bigint };
  id: string;
  createdAt: number;
  commitmentHex: string;
  /** Nullifier hash derived locally; used to reconcile spent notes with public transactions. */
  nullifierHash?: string;
  /** True if nullifier exists on-chain (note has been spent) */
  isSpent?: boolean;
  /** Token symbol this note belongs to (e.g. "zkBTC", "SOL") */
  tokenSymbol: string;
  /** Vault the note lives in; absent = the active vault. Set on merged cross-vault views. */
  vaultId?: "open" | "verified";
}

export type WithdrawalStatus = "pending" | "processing" | "broadcasting" | "confirmed" | "failed";

export interface ActiveWithdrawal {
  id: string;
  amountSats: bigint;
  btcAddress: string;
  status: WithdrawalStatus;
  solanaSignature?: string;
  btcTxid?: string;
  createdAt: number;
  updatedAt: number;
}

interface UTXOpiaState {
  // Poseidon
  isPoseidonReady: boolean;

  // Keys
  keys: UTXOpiaKeys | null;
  viewOnlyKeys: ViewOnlyKeys | null;
  isViewOnly: boolean;
  stealthAddress: StealthMetaAddress | null;
  stealthAddressEncoded: string | null;
  /** In-memory name-owner Solana keypair secret derived from the passkey seed.
   *  Non-fund; used only to own + sign the user's .utxopia.sol name. Never
   *  persisted. null for wallet/Privy logins (they bring their own authority). */
  passkeyNameOwnerSecret: Uint8Array | null;
  isLoading: boolean;
  error: string | null;
  hasKeys: boolean;
  /** The envelope seed for this session. Memory only — never persisted in the
   *  clear, and held at all so a member can re-export their recovery string or
   *  change their passphrase without a second unlock ceremony. */
  vaultSeed: Uint8Array | null;
  /** Keys came from an imported recovery file, so they exist only in memory —
   *  nothing was written to localStorage and a reload logs the user out. */
  isImportedSession: boolean;

  // Inbox
  inboxNotes: InboxNote[];
  inboxTotalSats: bigint;
  /** Per-token unspent balances (keyed by token symbol, e.g. "zkBTC", "SOL") */
  inboxBalancesByToken: Record<string, bigint>;
  inboxDepositCount: number;
  inboxLoading: boolean;
  /** One successful scan has landed for the current identity+vault. Views use
   *  this — not inboxLoading — to decide between a skeleton and the real
   *  numbers, so a background poll never blanks a balance that is already on
   *  screen. Reset on logout and on every vault/network switch. */
  inboxHasLoaded: boolean;
  inboxError: string | null;
  /** Poll the inbox hard until this timestamp. Set by the flows where the
   *  member has just done something and is waiting for the result — the only
   *  moments the 60s idle cadence is actually felt. Cleared early when a note
   *  lands, so the window costs nothing once the wait is over. */
  fastRefreshUntil: number;
  /** Keys were dropped for a vault/network switch and are being restored from
   *  the warm cache. Distinguishes "signed out" from "swapping identity", which
   *  otherwise look identical (no keys) and flash the sign-in hero mid-switch. */
  identityRestoring: boolean;

  // Public zkBTC balance (SPL Token-2022)
  publicZkbtcBalance: bigint;

  // Withdrawals
  activeWithdrawals: ActiveWithdrawal[];

  // Actions
  initPoseidon: () => Promise<void>;
  deriveKeys: (wallet: {
    publicKey: PublicKey;
    signMessage: (message: Uint8Array) => Promise<Uint8Array>;
  }) => Promise<void>;
  hydrateKeys: (walletPubkey: PublicKey) => Promise<boolean>;
  deriveKeysFromPasskeySeed: (seed: Uint8Array, networkId?: NetworkId) => Promise<void>;
  hydratePasskeyKeys: (networkId?: NetworkId) => Promise<boolean>;
  loadViewOnlyKeys: (encoded: string) => Promise<void>;
  importBackupKeys: (raw: string) => Promise<void>;
  clearKeys: (walletPubkey?: string, opts?: { keepSession?: boolean }) => void;
  setIdentityRestoring: (restoring: boolean) => void;
  /** Envelope-backed identity (see lib/vault-identity). Memory only. */
  createEnvelopeVault: (passphrase: string, deviceKeyMaterial: Uint8Array) => Promise<string>;
  unlockEnvelopeVault: (deviceKeyMaterial: Uint8Array) => Promise<void>;
  restoreEnvelopeVault: (
    recoveryString: string,
    passphrase: string,
    deviceKeyMaterial?: Uint8Array,
  ) => Promise<void>;
  exportRecoveryString: (passphrase: string) => Promise<string>;
  /** Drop this browser's wrapping. Distinct from logging out: after this the
   *  recovery string is the only way back in, on any device. */
  forgetVaultOnThisDevice: () => Promise<void>;
  /** Open a fast-poll window (default 2 minutes). */
  expectInboxSoon: (ms?: number) => void;
  refreshInbox: (connection?: Connection, force?: boolean) => Promise<void>;
  startRealtimeInbox: () => () => void;
  refreshPublicBalance: (walletPubkey?: PublicKey) => Promise<void>;
  submitWithdrawal: (withdrawal: Omit<ActiveWithdrawal, "id" | "createdAt" | "updatedAt">) => string;
  updateWithdrawal: (id: string, update: Partial<ActiveWithdrawal>) => void;
}

// ============================================================================
// Store
// ============================================================================

export const useUTXOpiaStore = create<UTXOpiaState>((set, get) => ({
  // Initial state
  isPoseidonReady: false,
  keys: null,
  viewOnlyKeys: null,
  isViewOnly: false,
  stealthAddress: null,
  stealthAddressEncoded: null,
  passkeyNameOwnerSecret: null,
  isLoading: false,
  error: null,
  hasKeys: false,
  isImportedSession: false,
  vaultSeed: null,
  inboxNotes: [],
  inboxTotalSats: 0n,
  inboxBalancesByToken: {},
  inboxDepositCount: 0,
  inboxLoading: false,
  inboxHasLoaded: false,
  inboxError: null,
  fastRefreshUntil: 0,
  identityRestoring: false,
  publicZkbtcBalance: 0n,
  activeWithdrawals: [],

  initPoseidon: async () => {
    try {
      await ensureChainEnvironment();
      set({ isPoseidonReady: true });
    } catch (err) {
      console.error("[UTXOpia] Failed to init:", err);
    }
  },

  deriveKeys: async (wallet) => {
    set({ isLoading: true, error: null });

    try {
      await ensureChainEnvironment();
      const client = UTXOpiaClient.instance();
      const vaultId = detectVault();
      const walletPubkey = wallet.publicKey.toBase58();
      const login = vaultId === "open"
        ? await client.loginWithWallet({
          publicKey: wallet.publicKey,
          signMessage: wallet.signMessage,
        })
        : await (async () => {
            const signature = await wallet.signMessage(
              new TextEncoder().encode(
                `utxopia:vault-identity:v1:${detectNetwork()}:${vaultId}`,
              ),
            );
            const seed = new Uint8Array(
              await crypto.subtle.digest("SHA-256", signature as BufferSource),
            );
            return client.loginWithSeed(seed);
          })();
      const {
        keys: derivedKeys,
        stealthAddress: meta,
        stealthAddressEncoded: encoded,
      } = login;

      // Persist encrypted under a wallet-signature secret (unlocks the session).
      const unlockSecret = await wallet.signMessage(
        new TextEncoder().encode("utxopia:storage-unlock:v1"),
      );
      await persistKeys(walletStorageOwner(walletPubkey, vaultId), unlockSecret);

      set({
        keys: derivedKeys,
        stealthAddress: meta,
        stealthAddressEncoded: encoded,
        hasKeys: true,
        isLoading: false,
      });
    } catch (err) {
      if (err instanceof Error) {
        const isUserRejection =
          err.name === "WalletSignMessageError" ||
          err.message.includes("User rejected") ||
          err.message.includes("user rejected");

        if (isUserRejection) {
          set({ isLoading: false });
          return;
        }

        if (err.message.includes("Internal JSON-RPC")) {
          set({ error: "Wallet error - please try reconnecting", isLoading: false });
        } else {
          set({ error: err.message, isLoading: false });
        }
      } else {
        set({ error: "Failed to derive keys", isLoading: false });
      }
    }
  },

  hydrateKeys: async (walletPubkey: PublicKey) => {
    await ensureChainEnvironment();
    const pubkeyStr = walletPubkey.toBase58();
    const storageId = walletStorageOwner(pubkeyStr, detectVault());
    const restored = await loadKeys(storageId, walletPubkey.toBytes());
    if (!restored) return false;

    // Sync the UTXOpiaClient singleton with the restored keys
    const client = UTXOpiaClient.instance();
    // restoreKeys needs serialized form — re-serialize via loadKeys result
    // Since loadKeys already deserialized, we re-read raw from localStorage
    try {
      const raw = localStorage.getItem(KEYS_STORAGE_PREFIX + storageId);
      const storageKey = cachedStorageKey(storageId);
      if (raw && storageKey) {
        const decrypted = await decryptData(storageKey, raw);
        const data = JSON.parse(decrypted);
        client.restoreKeys(data, walletPubkey.toBytes());
      }
    } catch {
      // Client sync failed — store still has the keys, just client won't be synced
    }

    set({
      keys: restored,
      stealthAddress: client.stealthAddress ?? null,
      stealthAddressEncoded: client.stealthAddressEncoded ?? null,
      hasKeys: true,
    });
    return true;
  },

  deriveKeysFromPasskeySeed: async (seed: Uint8Array, networkId?: NetworkId) => {
    set({ isLoading: true, error: null });
    try {
      await ensureChainEnvironment();
      const client = UTXOpiaClient.instance();
      // One passkey → a separate private identity per chain+network (see chainScopedPasskeySeed).
      const net = networkId ?? detectNetwork();
      const vaultId = detectVault();
      const credentialId = typeof window !== "undefined"
        ? localStorage.getItem("utxo:passkey_credential_id") || "default"
        : "default";

      // Warm the sibling vault's identity in the same unlock ceremony: derive,
      // log the client in, persist, then log in with the active vault last so
      // switching vaults hydrates silently instead of re-prompting the passkey.
      const siblingVault: VaultId = vaultId === "open" ? "verified" : "open";
      try {
        const siblingSeed = await chainScopedPasskeySeed(seed, net, siblingVault);
        await client.loginWithSeed(siblingSeed);
        await persistKeys(
          passkeyStorageOwner(credentialId, net, siblingVault),
          siblingSeed,
        );
      } catch {
        // Best-effort: the sibling vault prompts on first switch instead.
      }

      const scopedSeed = await chainScopedPasskeySeed(seed, net, vaultId);
      const { keys: derivedKeys, stealthAddress: meta, stealthAddressEncoded: encoded } =
        await client.loginWithSeed(scopedSeed);

      // Persist per chain+network, encrypted under the chain-scoped seed.
      await persistKeys(
        passkeyStorageOwner(credentialId, net, vaultId),
        scopedSeed,
      );

      // Derive + hold the in-memory name-owner Solana key (non-fund; for .utxopia.sol).
      const nameOwner = deriveNameOwnerKeypair(scopedSeed);
      set({ passkeyNameOwnerSecret: nameOwner.secretKey });

      set({
        keys: derivedKeys,
        stealthAddress: meta,
        stealthAddressEncoded: encoded,
        hasKeys: true,
        isLoading: false,
      });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : "Failed to derive keys from passkey",
        isLoading: false,
      });
    }
  },

  hydratePasskeyKeys: async (networkId?: NetworkId) => {
    try {
      await ensureChainEnvironment();
      if (typeof window === "undefined") return false;
      // Same "default" fallback as deriveKeysFromPasskeySeed — identities
      // persisted without a stored credential id must hydrate under the same
      // storage owner they were written to.
      const credentialId =
        localStorage.getItem("utxo:passkey_credential_id") || "default";

      const storageId = passkeyStorageOwner(
        credentialId,
        networkId ?? detectNetwork(),
        detectVault(),
      );
      const restored = await loadKeys(storageId, new Uint8Array(32));
      if (!restored) return false;

      // Sync the UTXOpiaClient singleton with the restored keys
      const client = UTXOpiaClient.instance();
      try {
        const raw = localStorage.getItem(KEYS_STORAGE_PREFIX + storageId);
        const storageKey = cachedStorageKey(storageId);
        if (raw && storageKey) {
          const decrypted = await decryptData(storageKey, raw);
          const data = JSON.parse(decrypted);
          client.restoreKeys(data, new Uint8Array(32));
        }
      } catch {
        // Client sync failed — store still has the keys
      }

      set({
        keys: restored,
        stealthAddress: client.stealthAddress ?? null,
        stealthAddressEncoded: client.stealthAddressEncoded ?? null,
        hasKeys: true,
      });
      return true;
    } catch {
      return false;
    }
  },

  loadViewOnlyKeys: async (encoded: string) => {
    try {
      await ensureChainEnvironment();
      const voKeys = decodeViewOnlyKeys(encoded);
      // Sync with UTXOpiaClient so computeNullifier works in view-only mode
      const client = UTXOpiaClient.instance();
      client.loginViewOnly(voKeys);
      set({
        keys: null,
        viewOnlyKeys: voKeys,
        isViewOnly: true,
        stealthAddress: null,
        stealthAddressEncoded: null,
        hasKeys: true,
        isLoading: false,
        error: null,
      });
    } catch (err) {
      set({ error: err instanceof Error ? err.message : "Invalid viewing key" });
    }
  },

  // Deliberately does not persist: the storage key is derived from a live
  // credential secret (see deriveStorageKey) and an imported file carries no
  // secret to derive it from. Spending keys stay in memory for this session.
  // Throws so the importing UI can show the failure next to the file picker.
  importBackupKeys: async (raw: string) => {
    await ensureChainEnvironment();
    // Pass the pool we are actually in: a file from the other one restores
    // "successfully" into an empty vault otherwise, with nothing to explain it.
    const { payload, solanaPublicKey } = parseVaultBackupFile(raw, detectVault());
    const client = UTXOpiaClient.instance();
    try {
      client.restoreKeys(payload.keys, solanaPublicKey);
    } catch {
      throw new Error("This recovery file could not be opened — its keys are unreadable.");
    }
    if (!client.keys) throw new Error("This recovery file contains no vault keys.");
    set({
      keys: client.keys,
      viewOnlyKeys: null,
      isViewOnly: false,
      stealthAddress: client.stealthAddress ?? null,
      stealthAddressEncoded: client.stealthAddressEncoded ?? null,
      hasKeys: true,
      isImportedSession: true,
      isLoading: false,
      error: null,
    });
  },

  clearKeys: (walletPubkey?: string, opts?: { keepSession?: boolean }) => {
    if (walletPubkey) {
      removeKeys(walletStorageOwner(walletPubkey, detectVault()));
    }
    // Vault switching passes keepSession so the identities warmed at unlock
    // stay decryptable; explicit logout drops every in-session storage key.
    if (!opts?.keepSession) {
      sessionStorageKeys.clear();
    }
    // Clear UTXOpiaClient state
    if (UTXOpiaClient.isInitialized) {
      UTXOpiaClient.instance().logout();
    }
    set({
      keys: null,
      viewOnlyKeys: null,
      isViewOnly: false,
      stealthAddress: null,
      stealthAddressEncoded: null,
      passkeyNameOwnerSecret: null,
      error: null,
      hasKeys: false,
      isImportedSession: false,
      vaultSeed: null,
      inboxNotes: [],
      inboxTotalSats: 0n,
      inboxBalancesByToken: {},
      inboxDepositCount: 0,
      inboxHasLoaded: false,
      inboxError: null,
      publicZkbtcBalance: 0n,
    });
  },

  setIdentityRestoring: (restoring) => set({ identityRestoring: restoring }),

  createEnvelopeVault: async (passphrase, deviceKeyMaterial) => {
    const { scope, metaAddressFor } = await envelopeContext();
    const { seed, recoveryString } = await createVault({
      scope,
      passphrase,
      deviceKeyMaterial,
      metaAddressFor,
    });
    await adoptSeedIntoSession(set, seed);
    return recoveryString;
  },

  unlockEnvelopeVault: async (deviceKeyMaterial) => {
    const { scope, metaAddressFor } = await envelopeContext();
    const { seed } = await unlockWithDevice({ scope, deviceKeyMaterial, metaAddressFor });
    await adoptSeedIntoSession(set, seed);
  },

  restoreEnvelopeVault: async (recoveryString, passphrase, deviceKeyMaterial) => {
    const { scope, metaAddressFor } = await envelopeContext();
    try {
      const { seed } = await unlockWithRecoveryString({
        scope,
        recoveryString,
        passphrase,
        deviceKeyMaterial,
        metaAddressFor,
      });
      await adoptSeedIntoSession(set, seed);
    } catch (err) {
      // metaAddressFor logs the client in to learn the address, so a failed
      // guard check leaves a stranger's identity loaded. Put it back.
      if (UTXOpiaClient.isInitialized) UTXOpiaClient.instance().logout();
      throw err;
    }
  },

  exportRecoveryString: async (passphrase) => {
    const seed = get().vaultSeed;
    const metaAddress = get().stealthAddressEncoded;
    if (!seed || !metaAddress) {
      throw new Error("Unlock your vault before exporting a recovery string.");
    }
    return buildRecoveryString({ seed, passphrase, metaAddress });
  },

  forgetVaultOnThisDevice: async () => {
    const { scope } = await envelopeContext();
    clearDeviceEnvelope(scope);
    get().clearKeys();
  },

  expectInboxSoon: (ms = 120_000) => set({ fastRefreshUntil: Date.now() + ms }),

  refreshInbox: async (_connection, force) => {
    const { keys, viewOnlyKeys, isViewOnly } = get();
    if (!keys && !viewOnlyKeys) {
      set({
        inboxNotes: [],
        inboxTotalSats: 0n,
        inboxBalancesByToken: {},
        inboxDepositCount: 0,
        inboxHasLoaded: false,
      });
      return;
    }

    // Force flag drops the incremental mark so we re-fetch and re-scan everything
    if (force) {
      lastScannedLeafIndex = -1;
    }

    // Deduplicate: if already fetching, wait for that to complete
    if (inboxFetchPromise) {
      return inboxFetchPromise;
    }

    set({ inboxLoading: true, inboxError: null });

    const doFetch = async () => {
      try {
        await ensureChainEnvironment();
        const env = getChainEnvironment();
        const inboxIdentity = `${env.networkId}:${env.vaultId}`;
        if (lastInboxIdentity !== inboxIdentity) {
          lastScannedLeafIndex = -1;
          lastInboxIdentity = inboxIdentity;
          set({
            inboxNotes: [],
            inboxTotalSats: 0n,
            inboxBalancesByToken: {},
            inboxDepositCount: 0,
            inboxHasLoaded: false,
          });
        }
        if (viewOnlyKeys) {
          UTXOpiaClient.instance().loginViewOnly(viewOnlyKeys);
        }
        // Only fetch announcements above the mark; the ones below are already
        // decrypted and carried forward. Nullifiers are ALWAYS re-checked below.
        const incremental = lastScannedLeafIndex >= 0;
        const inboxSource = await fetchInboxSource(
          env,
          incremental ? lastScannedLeafIndex : undefined,
        );
        const announcements = inboxSource.announcements;

        const utxopiaClient = UTXOpiaClient.instance();

        // Scan locally for privacy (server doesn't know which are ours)
        type ScannedWithToken = (ScannedNote | ViewOnlyScannedNote) & { tokenSymbol: string; isSpent?: boolean };
        // Demo notes are re-appended from the ledger further down, so they must
        // not enter the carried-forward basis or they'd double up.
        const scanned: ScannedWithToken[] = incremental
          ? get().inboxNotes
              .filter((n) => !n.id.startsWith("alpha-demo-"))
              .map(n => ({
                commitment: hexToBytes(n.commitmentHex),
                amount: n.amount,
                leafIndex: n.leafIndex,
                ephemeralPub: n.ephemeralPub ?? new Uint8Array(32),
                // Preserve the spend-time stealth public key; without it the claim
                // path can't prove ownership (Stealth key mismatch) on a re-scan.
                stealthPub: n.stealthPub,
                blockTime: n.createdAt > 1_000_000_000_000
                  ? Math.floor(n.createdAt / 1000)
                  : (n.createdAt > 0 ? n.createdAt : 0),
                tokenSymbol: n.tokenSymbol,
              }))
          : [];

        if (announcements.length > 0) {
          const fresh = await scanByTokenPlan(
            planTokenScan(env, announcements),
            (rows, tokenId) => isViewOnly && viewOnlyKeys
              ? scanAnnouncementsViewOnly(viewOnlyKeys, rows, tokenId)
              : scanUnifiedNotes(keys!, rows, tokenId),
            new Set(scanned.map((n) => n.leafIndex)),
          );
          scanned.push(...(fresh as ScannedWithToken[]));
        }
        // Advanced only once the scan results are in state (below) — an error in
        // between would otherwise skip this range forever.
        const nextScannedLeafIndex = announcements.reduce(
          (max, ann) => Math.max(max, ann.leafIndex),
          lastScannedLeafIndex,
        );

        // Check which notes are spent via backend batch nullifier API (use proxy)
        const backendUrl = "";

        // Compute nullifier hashes (hex) for each note via UTXOpiaClient
        const nullifierData = scanned.map((note) => {
          const hashBytes = utxopiaClient.computeNullifier(note);
          const hashHex = Buffer.from(hashBytes).toString("hex");
          return { note, hashHex };
        });

        // Fetch spent nullifier PDAs (incremental sync) and match client-side for privacy
        let notesWithSpentStatus: (typeof scanned[number] & { isSpent: boolean })[];
        if (nullifierData.length === 0) {
          notesWithSpentStatus = [];
        } else {
          const spentNullifiers = inboxSource.spentNullifiers;
          if (spentNullifiers) {
            notesWithSpentStatus = nullifierData.map((d) => ({
              ...d.note,
              nullifierHash: d.hashHex,
              isSpent: spentNullifiers.has(d.hashHex),
            }));
          } else {
            const spentPdas = await fetchSpentNullifierPDAs(
              backendUrl, env.networkId, env.vaultId,
            );
            notesWithSpentStatus = nullifierData.map((d) => ({
              ...d.note,
              nullifierHash: d.hashHex,
              isSpent: spentPdas.has(nullifierHashToPDA(d.hashHex)),
            }));
          }
        }

        const notes: InboxNote[] = notesWithSpentStatus.map((note, index) => {
          // Convert commitment bytes to hex (big-endian bytes to hex string)
          const rawHex = Buffer.from(note.commitment).toString("hex");
          const commitmentHex = rawHex.toLowerCase().padStart(64, "0");

          return {
            ...note,
            id: `${commitmentHex.slice(0, 16)}-${index}`,
            createdAt: note.blockTime
              ? note.blockTime * 1000  // Convert seconds → ms
              : Date.now(),
            commitmentHex,
            tokenSymbol: note.tokenSymbol ?? "zkBTC",
          };
        });

        const alphaDemoNotes = getAlphaDemoInboxNotes(env.networkId, get().stealthAddressEncoded);
        const existingIds = new Set(notes.map((note) => note.id));
        for (const note of alphaDemoNotes) {
          if (!existingIds.has(note.id)) notes.push(note);
        }

        notes.sort((a, b) => b.createdAt - a.createdAt);

        // Calculate balance only from unspent notes
        const unspentNotes = notes.filter(n => !n.isSpent);
        const totalSats = unspentNotes.reduce(
          (sum, note) => sum + BigInt(note.amount ?? 0),
          0n
        );

        // Per-token balances
        const balancesByToken: Record<string, bigint> = {};
        for (const note of unspentNotes) {
          const sym = note.tokenSymbol;
          balancesByToken[sym] = (balancesByToken[sym] ?? 0n) + BigInt(note.amount ?? 0);
        }

        // The thing being waited for has arrived; stop paying for the wait.
        const landed = unspentNotes.length > get().inboxDepositCount;
        set({
          inboxNotes: notes,
          inboxTotalSats: totalSats,
          inboxBalancesByToken: balancesByToken,
          inboxDepositCount: unspentNotes.length,
          inboxLoading: false,
          inboxHasLoaded: true,
          ...(landed ? { fastRefreshUntil: 0 } : {}),
        });
        lastScannedLeafIndex = nextScannedLeafIndex;
      } catch (err) {
        console.error("[UTXOpia] Inbox error:", err);
        set({
          inboxError: err instanceof Error ? err.message : "Failed to fetch inbox",
          inboxLoading: false,
        });
      } finally {
        inboxFetchPromise = null;
      }
    };

    inboxFetchPromise = doFetch();
    return inboxFetchPromise;
  },

  startRealtimeInbox: () => {
    const client = getEventClient();
    client.start().catch((err) => {
      console.warn("[UTXOpia] EventClient start failed:", err);
    });
    const unsub = client.onAnnouncement(() => {
      // New announcements arrived via WS — trigger inbox refresh
      const store = get();
      if (store.keys || store.viewOnlyKeys) {
        store.refreshInbox();
      }
    });
    return () => {
      unsub();
      client.close();
      resetEventClient();
    };
  },

  refreshPublicBalance: async (walletPubkey?: PublicKey) => {
    if (!walletPubkey) {
      set({ publicZkbtcBalance: 0n });
      return;
    }
    try {
      const chainEnv = await ensureChainEnvironment();
      const response = await fetch(
        API_ENDPOINTS.PUBLIC_ZKBTC_BALANCE(walletPubkey.toBase58(), chainEnv.networkId),
        { cache: "no-store" }
      );
      if (!response.ok) {
        throw new Error(`Balance request failed with ${response.status}`);
      }
      const result = await response.json();
      set({ publicZkbtcBalance: BigInt(result?.amount ?? "0") });
    } catch (err) {
      console.error("[UTXOpia] Failed to fetch public zkBTC balance:", err);
    }
  },

  submitWithdrawal: (withdrawal) => {
    const id = crypto.randomUUID();
    const now = Date.now();
    const newWithdrawal: ActiveWithdrawal = {
      ...withdrawal,
      id,
      createdAt: now,
      updatedAt: now,
    };
    set((state) => ({
      activeWithdrawals: [...state.activeWithdrawals, newWithdrawal],
    }));
    return id;
  },

  updateWithdrawal: (id, update) => {
    set((state) => ({
      activeWithdrawals: state.activeWithdrawals.map((w) =>
        w.id === id ? { ...w, ...update, updatedAt: Date.now() } : w
      ),
    }));
  },
}));

// ============================================================================
// Convenience Hooks
// ============================================================================

export function useUTXOpia() {
  return useUTXOpiaStore();
}

export function useUTXOpiaKeys() {
  const store = useUTXOpiaStore();
  return {
    keys: store.keys,
    stealthAddress: store.stealthAddress,
    stealthAddressEncoded: store.stealthAddressEncoded,
    isLoading: store.isLoading,
    error: store.error,
    deriveKeys: store.deriveKeys,
    clearKeys: store.clearKeys,
    hasKeys: store.hasKeys,
  };
}

export function useStealthInbox() {
  const store = useUTXOpiaStore();
  return {
    notes: store.inboxNotes,
    totalAmountSats: store.inboxTotalSats,
    balancesByToken: store.inboxBalancesByToken,
    depositCount: store.inboxDepositCount,
    isLoading: store.inboxLoading,
    hasLoaded: store.inboxHasLoaded,
    error: store.inboxError,
    refresh: store.refreshInbox,
    startRealtime: store.startRealtimeInbox,
    hasKeys: store.hasKeys,
  };
}
