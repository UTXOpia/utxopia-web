/**
 * E_pin, kept off this device — the wrapping a new device fetches before it can
 * ask for a PIN.
 *
 * `vault-identity` puts every wrapping in localStorage, which is what makes a
 * new device need the recovery string: the PRF output is reproducible on any
 * device the passkey synced to, and the login signature is reproducible on any
 * device the member logs into, but neither has any ciphertext to open. This
 * module is where the ciphertext for the login wrapping goes so that it does.
 *
 * The trade is explicit and it is the whole reason this file exists: we now
 * hold something. What keeps that survivable is that we hold exactly one half.
 *
 *   we have            the envelope, and a proof of the PIN
 *   we never have      the signature, and therefore not the key
 *   Privy has          the signature, over a salt it cannot decrypt anything
 *                      with
 *   Privy never has    the envelope
 *
 * `deriveFromPin` salts the PIN with the signature, so our copy of the
 * ciphertext plus a PIN swept out of `pinProof` still opens nothing. It takes
 * both parties, which is the property the member is told they are trusting.
 *
 * WHY THE PROOF EXISTS AT ALL. Gating release on the blob id alone would make
 * this theatre: the id is derivable by anyone who can reach the member's
 * account, so a stolen email would otherwise download the ciphertext outright —
 * at which point six digits fall to an offline sweep in under an hour. The proof moves that sweep onto a server that counts, which is the only
 * place a six-digit secret has ever been safe. The lockout is not a nicety
 * around this design; it *is* this design.
 */

import { argon2id } from "@noble/hashes/argon2";
import { sha256 } from "@noble/hashes/sha2";
import { bytesToHex } from "@utxopia/sdk";
import { KDF_V1, assertPin, envelopeToHex, envelopeFromHex, type VaultEnvelope } from "@/lib/vault-envelope";
import { scopeTag, type VaultScope } from "@/lib/vault-identity";

/**
 * FROZEN. Which row this member's wrapping is.
 *
 * From the provider's account id, not from a signature, and the ordering is
 * what forces it: the message a signature is bound to now carries the
 * wrapping's salt, and that salt lives inside the wrapping this id is used to
 * fetch. Deriving the id from a signature would mean signing twice on a new
 * device — once over a constant to find the row, once over the salt to open it
 * — and the second prompt buys nothing.
 *
 * What it costs is narrow: anyone who learns the account id can address the
 * row, where before they needed to be able to sign. Both require knowing the
 * member; neither yields the ciphertext, which still takes the PIN and its
 * counter. The id is opaque either way — a hash, carrying no address and
 * nothing derived from the PIN.
 *
 * The scope is in it so Open and Verified do not share a row.
 */
function blobId(scope: VaultScope, accountId: string): string {
  return bytesToHex(
    sha256(new Uint8Array([
      ...new TextEncoder().encode("utxopia:blob-id:v2|"),
      ...scopeTag(scope),
      ...new TextEncoder().encode(accountId),
    ])),
  );
}

/**
 * FROZEN. What we are allowed to check the PIN against.
 *
 * Salted from the blob id rather than the signature: a proof whose salt we
 * already hold must not be the same computation as the key we must not hold.
 *
 * KDF_V1 rather than the heavier PIN cost. This one is not what stands between
 * a leaked table and the vault — the missing signature is — so its only job is
 * to keep the PIN itself out of a dump, and to stay cheap enough that unlocking
 * does not run argon2 twice at 600ms.
 */
function pinProof(id: string, pin: string): string {
  return bytesToHex(
    argon2id(
      new TextEncoder().encode(pin.trim()),
      sha256(new TextEncoder().encode(`utxopia:pin-proof:v1|${id}`)),
      { m: KDF_V1.m, t: KDF_V1.t, p: KDF_V1.p, dkLen: 32 },
    ),
  );
}

export interface RemoteCredentials {
  id: string;
  proof: string;
}

export function remoteCredentials(input: {
  scope: VaultScope;
  pin: string;
  accountId: string;
}): RemoteCredentials {
  assertPin(input.pin);
  if (!input.accountId) throw new Error("Sign in before saving or opening a backup.");
  const id = blobId(input.scope, input.accountId);
  return { id, proof: pinProof(id, input.pin) };
}

// ---------------------------------------------------------------------------
// Did this device publish a copy?
//
// A device-local record of a write we already made, not a question asked of the
// server. An exists endpoint keyed by the blob id alone would be the unmetered
// oracle every verb's shared counter exists to prevent: the id is derivable by
// anyone who can reach the member's account, so a stranger holding a stolen
// session could ask whether they had found a real member without spending a
// try. What the member actually needs answered — "will my new phone work?" —
// was known here at write time and needs nobody asked.
//
// ponytail: local, so it cannot see a copy deleted from another device, and a
// browser whose storage was cleared reports nothing rather than reporting no.
// Both fail toward telling the member to keep their recovery string, which is
// the safe direction. Revisit if members routinely hold two armed devices.
// ---------------------------------------------------------------------------

const SAVED_PREFIX = "utxo:blob-saved:v1:";

function savedKey(scope: VaultScope): string {
  return `${SAVED_PREFIX}${scope.networkId}:${scope.vaultId}`;
}

/** A member who forgets this device should stop being told a copy backs it. */
export function clearRemoteBackupFlag(scope: VaultScope): void {
  if (typeof window !== "undefined") localStorage.removeItem(savedKey(scope));
}

export function remoteBackupSaved(scope: VaultScope): boolean {
  if (typeof window === "undefined") return false;
  return localStorage.getItem(savedKey(scope)) === "1";
}

export class RemoteLockedError extends Error {
  constructor(until: number) {
    const hours = Math.max(1, Math.ceil((until * 1000 - Date.now()) / 3_600_000));
    super(`Too many wrong PINs. Try again in about ${hours}h, or use your recovery string.`);
    this.name = "RemoteLockedError";
  }
}

export class RemoteMissingError extends Error {
  constructor() {
    super("No saved vault found for this login. Restore from your recovery string.");
    this.name = "RemoteMissingError";
  }
}

/** Wrong PIN, or a login that never had a wrapping here. Deliberately one
 *  message: telling the two apart tells a stranger holding a stolen session
 *  whether they have found a real member. */
export class RemoteRejectedError extends Error {
  constructor(remaining?: number) {
    super(
      remaining !== undefined && remaining <= 3
        ? `That PIN did not open this vault. ${remaining} ${remaining === 1 ? "try" : "tries"} left before this login is locked out.`
        : "That PIN did not open this vault.",
    );
    this.name = "RemoteRejectedError";
  }
}

const ENDPOINT = "/api/vault-blob";

/**
 * Publish this member's login wrapping. Best-effort by design: a member whose
 * vault exists locally and whose recovery string is written down has lost
 * nothing if this fails, and failing the whole vault creation over a backup
 * would be the worse trade.
 */
export async function putRemoteEnvelope(input: {
  scope: VaultScope;
  pin: string;
  accountId: string;
  envelope: VaultEnvelope;
}): Promise<boolean> {
  const { id, proof } = remoteCredentials(input);
  try {
    const response = await fetch(ENDPOINT, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, proof, envelope: envelopeToHex(input.envelope) }),
    });
    if (response.ok) localStorage.setItem(savedKey(input.scope), "1");
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Remove our copy.
 *
 * The exit from the trade this whole module asks the member to make. After
 * this their recovery string and their armed devices are the only ways in,
 * which is exactly where they were before they set a PIN.
 */
export async function deleteRemoteEnvelope(input: {
  scope: VaultScope;
  pin: string;
  accountId: string;
}): Promise<void> {
  await send(ENDPOINT, "DELETE", remoteCredentials(input));
  localStorage.removeItem(savedKey(input.scope));
}

/** One place that turns a status code into the right thing to say. Every verb
 *  shares the lockout, so every verb has to be able to report it. */
async function send(url: string, method: string, body: unknown): Promise<Response> {
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  if (response.status === 423) {
    const parsed = (await response.json().catch(() => ({}))) as { lockedUntil?: number };
    throw new RemoteLockedError(parsed.lockedUntil ?? 0);
  }
  if (response.status === 401 || response.status === 404) {
    const parsed = (await response.json().catch(() => ({}))) as { remaining?: number };
    throw new RemoteRejectedError(parsed.remaining);
  }
  if (!response.ok) throw new RemoteMissingError();
  return response;
}

export async function getRemoteEnvelope(input: {
  scope: VaultScope;
  pin: string;
  accountId: string;
}): Promise<VaultEnvelope> {
  const response = await send(ENDPOINT, "POST", remoteCredentials(input));
  const body = (await response.json()) as { envelope?: string };
  if (!body.envelope) throw new RemoteMissingError();
  // A release is proof of a copy, the same as a write is. Set here too, or a
  // device armed by an unlock rather than by a publish would go on believing it
  // has no backup — and go on keeping a local wrapping to make up for it.
  localStorage.setItem(savedKey(input.scope), "1");
  return envelopeFromHex(body.envelope);
}
