"use client";

import { useState, useCallback, useEffect } from "react";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@utxopia/sdk";
import { detectNetwork } from "@/lib/network-config";
import {
  startRegistration,
  startAuthentication,
  browserSupportsWebAuthn,
  bufferToBase64URLString,
} from "@simplewebauthn/browser";
import type {
  PublicKeyCredentialCreationOptionsJSON,
  PublicKeyCredentialRequestOptionsJSON,
} from "@simplewebauthn/browser";

const CREDENTIAL_STORAGE_KEY = "utxo:passkey_credential_id";
const SEED_STORAGE_KEY = "utxo:passkey_seed";
/** Derive per-user PRF salt by mixing domain separator with credential ID.
 *  "utxopia-passkey-prf-v1" is a LOAD-BEARING domain separator — once real
 *  passkey accounts exist, this string is FROZEN. Changing it re-derives every
 *  user's keys and locks them out of funds. Bump the version suffix only as a
 *  deliberate, migrated break. */
function getPrfSalt(credentialId?: string | null): Uint8Array {
  const base = "utxopia-passkey-prf-v1";
  const input = credentialId ? `${base}:${credentialId}` : base;
  return sha256(new TextEncoder().encode(input));
}

const RP_NAME = "UTXOpia";

/**
 * What this credential is called in the member's passkey list.
 *
 * Cosmetic to WebAuthn and load-bearing to a person: it is the only thing
 * distinguishing our entry from every other site's, and — because `user.id` is
 * random per registration — the only thing distinguishing a working credential
 * from an orphan left behind by a second `register()` call. Every entry used to
 * read "utxopia-user", so a member with an orphan could not tell which of two
 * identical rows was the one holding their vault, and would not dare delete
 * either.
 *
 * The network is in it because that is the coarsest thing a member might
 * genuinely have two of, and the finest thing that is safe to put here: this
 * string is stored by the authenticator and syncs to their keychain, so it must
 * never carry the login's email or the vault's meta-address. Naming a social
 * account or an on-chain identity in a synced keychain is exactly the link this
 * pool exists to prevent.
 *
 * Only affects credentials made from now on — the label is written at
 * registration and nothing can rewrite an existing one.
 */
function credentialLabel(): { name: string; displayName: string } {
  const network = detectNetwork();
  return network === "mainnet"
    ? { name: "utxopia", displayName: "UTXOpia vault" }
    : { name: `utxopia-${network}`, displayName: `UTXOpia vault (${network})` };
}

/**
 * The registrable domain rather than the exact host.
 *
 * A credential belongs to one RP id and nothing else, and the hostname made
 * `app.` and `www.` two different relying parties — so a passkey registered on
 * one was not merely PRF-less on the other, it did not exist there. WebAuthn
 * allows any registrable suffix of the origin, and the parent domain is the
 * one that covers every subdomain this app will ever be served from.
 *
 * Anything not under utxopia.com — localhost, preview deployments — keeps its
 * own host: they are separate relying parties on purpose.
 */
export function registrableRpId(hostname: string): string {
  return hostname === "utxopia.com" || hostname.endsWith(".utxopia.com") ? "utxopia.com" : hostname;
}

function getRpId(): string {
  if (typeof window === "undefined") return "localhost";
  return registrableRpId(window.location.hostname);
}

export interface SeedRequest {
  /**
   * Refuse the fallback-seed path.
   *
   * Without PRF this hook falls back to a random seed encrypted under a key
   * derived from the credential id — and the credential id sits in plaintext
   * localStorage beside it, so anyone who can read the profile can rebuild that
   * key. That is adequate as a biometric gate, and useless as the wrapping key
   * for a vault envelope: it would encrypt the seed under something already
   * lying next to the ciphertext.
   *
   * Callers wrapping key material pass this and handle the refusal.
   */
  requirePrf?: boolean;
}

export class PrfUnavailableError extends Error {
  constructor() {
    super(
      "This browser cannot store a vault key safely. Your vault still works — you will need your recovery string each time you open it here.",
    );
    this.name = "PrfUnavailableError";
  }
}

function getStoredCredentialId(): string | null {
  try {
    return localStorage.getItem(CREDENTIAL_STORAGE_KEY);
  } catch {
    return null;
  }
}

function storeCredentialId(id: string): void {
  try {
    localStorage.setItem(CREDENTIAL_STORAGE_KEY, id);
  } catch {
    // localStorage unavailable
  }
}

export function clearStoredCredential(): void {
  try {
    localStorage.removeItem(CREDENTIAL_STORAGE_KEY);
    localStorage.removeItem(SEED_STORAGE_KEY);
  } catch {
    // ignore
  }
}

// ── Fallback seed storage (used when PRF is not available) ──

/** Derive AES-GCM key from credential ID for encrypting fallback seed at rest.
 *  "utxopia-seed-enc:" and "utxopia-fallback-seed" are LOAD-BEARING HKDF inputs.
 *  Once real passkey accounts exist these are FROZEN — changing them breaks the
 *  fallback-seed recovery path and locks users out. */
async function deriveStorageKey(credentialId: string): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`utxopia-seed-enc:${credentialId}`),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(32), info: new TextEncoder().encode("utxopia-fallback-seed") },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

async function storeFallbackSeed(seed: Uint8Array, credentialId: string): Promise<void> {
  try {
    const key = await deriveStorageKey(credentialId);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const seedCopy = new Uint8Array(seed).buffer as ArrayBuffer;
    const ct = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, seedCopy));
    // Store as iv(12) || ciphertext
    const combined = new Uint8Array(iv.length + ct.length);
    combined.set(iv);
    combined.set(ct, iv.length);
    localStorage.setItem(SEED_STORAGE_KEY, bytesToHex(combined));
  } catch {
    // ignore
  }
}

async function loadFallbackSeed(credentialId: string): Promise<Uint8Array | null> {
  try {
    const hex = localStorage.getItem(SEED_STORAGE_KEY);
    if (!hex) return null;
    const data = hexToBytes(hex);
    if (data.length < 28) return null; // iv(12) + tag(16) minimum
    const key = await deriveStorageKey(credentialId);
    const iv = data.slice(0, 12);
    const ct = data.slice(12);
    const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return new Uint8Array(plaintext);
  } catch {
    return null;
  }
}

// ── PRF extraction ──

/**
 * Try to extract PRF output from WebAuthn credential response.
 * Returns 32-byte seed or null if PRF not supported.
 */
function tryExtractPrfOutput(
  extensions: AuthenticationExtensionsClientOutputs | undefined,
): Uint8Array | null {
  if (!extensions) return null;

  const prf = (extensions as Record<string, unknown>).prf as
    | { results?: { first?: ArrayBuffer } }
    | undefined;
  if (!prf?.results?.first) return null;

  return sha256(new Uint8Array(prf.results.first));
}

function randomBase64URL(length: number): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bufferToBase64URLString(bytes.buffer as ArrayBuffer);
}

export interface UsePasskeyReturn {
  isSupported: boolean;
  hasCredential: boolean;
  isLoading: boolean;
  error: string | null;
  register: (opts?: SeedRequest) => Promise<Uint8Array | null>;
  authenticate: (opts?: SeedRequest) => Promise<Uint8Array | null>;
  clearCredential: () => void;
}

export function usePasskey(): UsePasskeyReturn {
  const [isSupported, setIsSupported] = useState(false);
  const [hasCredential, setHasCredential] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setIsSupported(browserSupportsWebAuthn());
    setHasCredential(!!getStoredCredentialId());
  }, []);

  const register = useCallback(async (opts?: SeedRequest): Promise<Uint8Array | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const rpId = getRpId();

      // Use base PRF salt for registration (no credential ID yet)
      const prfSalt = getPrfSalt();

      const creationOptions: PublicKeyCredentialCreationOptionsJSON = {
        rp: { name: RP_NAME, id: rpId },
        user: {
          // Random, so this never silently replaces a credential already
          // holding a wrapping. `vault-setup` is what keeps a second one from
          // being minted in the first place — see the reuse note there.
          id: randomBase64URL(32),
          ...credentialLabel(),
        },
        challenge: randomBase64URL(32),
        pubKeyCredParams: [
          { alg: -7, type: "public-key" }, // ES256
          { alg: -257, type: "public-key" }, // RS256
        ],
        authenticatorSelection: {
          residentKey: "required",
          userVerification: "required",
        },
        extensions: {
          prf: {
            eval: { first: prfSalt.buffer as ArrayBuffer },
          },
        } as Record<string, unknown>,
      };

      const credential = await startRegistration({
        optionsJSON: creationOptions,
      });

      // PRF value is usually NOT returned by create() — browsers return only
      // prf.enabled there. Reading it at create time made us fall back to a random,
      // browser-local seed even for PRF-capable authenticators, so the vault never
      // travelled across devices. Derive the seed from a follow-up assertion with
      // the SAME base salt instead — that yields the deterministic PRF output that
      // every device with this synced passkey reproduces. authenticate() uses the
      // identical get()+base-salt path, so register and sign-in match.
      let seed = tryExtractPrfOutput(credential.clientExtensionResults);
      const prfEnabled =
        (credential.clientExtensionResults as { prf?: { enabled?: boolean } }).prf?.enabled === true;

      if (!seed && prfEnabled) {
        const assertion = await startAuthentication({
          optionsJSON: {
            rpId,
            challenge: randomBase64URL(32),
            allowCredentials: [{ id: credential.id, type: "public-key" }],
            userVerification: "required",
            extensions: {
              prf: { eval: { first: prfSalt.buffer as ArrayBuffer } },
            } as Record<string, unknown>,
          },
        });
        seed = tryExtractPrfOutput(assertion.clientExtensionResults);
      }

      if (!seed) {
        if (opts?.requirePrf) throw new PrfUnavailableError();
        // Truly no PRF — generate random seed and encrypt in localStorage.
        // The passkey serves as a biometric gate; the seed is encrypted at rest.
        // This path is browser-bound (no cross-device recovery).
        seed = new Uint8Array(32);
        crypto.getRandomValues(seed);
        await storeFallbackSeed(seed, credential.id);
      }

      storeCredentialId(credential.id);
      setHasCredential(true);

      return seed;
    } catch (err) {
      if (err instanceof Error) {
        if (
          err.name === "NotAllowedError" ||
          err.message.includes("cancelled")
        ) {
          setError(null);
          return null;
        }
        setError(err.message);
      } else {
        setError("Failed to create passkey");
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const authenticate = useCallback(async (opts?: SeedRequest): Promise<Uint8Array | null> => {
    setIsLoading(true);
    setError(null);
    try {
      const rpId = getRpId();
      const storedId = getStoredCredentialId();

      // MUST match registration's PRF salt or the derived seed differs and the user
      // lands in a different (empty) vault. Registration has no credential ID yet, so
      // it uses the base salt — authenticate must use the base salt too, NOT a
      // per-credential one. (The base string is the frozen domain separator.)
      const prfSalt = getPrfSalt();

      const requestOptions: PublicKeyCredentialRequestOptionsJSON = {
        rpId,
        challenge: randomBase64URL(32),
        allowCredentials: storedId
          ? [{ id: storedId, type: "public-key" }]
          : [],
        userVerification: "required",
        extensions: {
          prf: {
            eval: { first: prfSalt.buffer as ArrayBuffer },
          },
        } as Record<string, unknown>,
      };

      const credential = await startAuthentication({
        optionsJSON: requestOptions,
      });

      // Try PRF first
      let seed = tryExtractPrfOutput(credential.clientExtensionResults);

      if (!seed) {
        if (opts?.requirePrf) throw new PrfUnavailableError();
        // PRF not available — load encrypted fallback seed from localStorage
        const credId = storedId || credential.id;
        seed = await loadFallbackSeed(credId);
        if (!seed) {
          throw new Error(
            "No saved key found. This can happen if you registered on a different device. " +
              "Please use the original device or connect a wallet instead.",
          );
        }
      }

      if (!storedId) {
        storeCredentialId(credential.id);
        setHasCredential(true);
      }

      return seed;
    } catch (err) {
      if (err instanceof Error) {
        if (
          err.name === "NotAllowedError" ||
          err.message.includes("cancelled")
        ) {
          setError(null);
          return null;
        }
        setError(err.message);
      } else {
        setError("Failed to authenticate with passkey");
      }
      return null;
    } finally {
      setIsLoading(false);
    }
  }, []);

  const clearCredential = useCallback(() => {
    clearStoredCredential();
    setHasCredential(false);
  }, []);

  return {
    isSupported,
    hasCredential,
    isLoading,
    error,
    register,
    authenticate,
    clearCredential,
  };
}
