"use client";

import { UTXOpiaClient } from "@utxopia/sdk";

const BACKUP_STATUS_PREFIX = "utxo:backup:";

export type BackupIdentityKind = "passkey" | "wallet" | "auth" | "unknown";

export interface VaultBackupPayload {
  version: 1;
  app: "UTXOpia";
  warning: string;
  exportedAt: string;
  identity: string;
  /**
   * Which pool this file recovers. Optional because files written before this
   * existed do not have it — those restore as they always did.
   *
   * A private identity is per-pool (`chainScopedPasskeySeed` mixes the vault
   * into the seed; wallet vaults scope storage by it), but `identity` here is
   * only `wallet:<pubkey>`, which is *the same string for both pools*. So one
   * member's two recovery files were indistinguishable by name and by content:
   * downloading the second silently overwrote the first in the download folder,
   * and restoring the wrong one shows an empty vault with no clue why.
   */
  vault?: string;
  keys: Record<string, unknown>;
}

export function getBackupIdentityForKeys(keys: {
  solanaPublicKey?: Uint8Array | number[];
} | null): string | null {
  if (!keys) return null;
  if (isPasskeyVault(keys)) {
    return getPasskeyBackupIdentity();
  }
  const pubkey = keys.solanaPublicKey;
  if (pubkey && Array.from(pubkey).some((byte) => byte !== 0)) {
    return `wallet:${Buffer.from(pubkey).toString("hex")}`;
  }
  return "vault:unknown";
}

export function getPasskeyBackupIdentity(): string {
  if (typeof window === "undefined") return "passkey:default";
  const credentialId = localStorage.getItem("utxo:passkey_credential_id") || "default";
  return `passkey:${credentialId}`;
}

export function hasVaultBackup(identity: string | null): boolean {
  if (!identity || typeof window === "undefined") return false;
  return localStorage.getItem(BACKUP_STATUS_PREFIX + identity) === "1";
}

export function hasBackupForKeys(keys: {
  solanaPublicKey?: Uint8Array | number[];
} | null): boolean {
  return hasVaultBackup(getBackupIdentityForKeys(keys));
}

export function markVaultBackupComplete(identity: string): void {
  if (typeof window === "undefined") return;
  localStorage.setItem(BACKUP_STATUS_PREFIX + identity, "1");
}

/** Parse a recovery file for import. Unlike the vault-side checks, this cannot
 *  compare against a live vault — the whole point of importing is that the
 *  original credential is gone — so it validates shape only. The Solana pubkey
 *  comes from the identity string: key reconstruction needs the same bytes the
 *  keys were serialized under, and passkey vaults derive under all-zeros. */
export function parseVaultBackupFile(raw: string, currentVault?: string): {
  payload: VaultBackupPayload;
  solanaPublicKey: Uint8Array;
} {
  let payload: Partial<VaultBackupPayload>;
  try {
    payload = JSON.parse(raw) as Partial<VaultBackupPayload>;
  } catch {
    throw new Error("This is not a valid UTXOpia recovery file.");
  }
  if (payload.version !== 1 || payload.app !== "UTXOpia" || !payload.identity || !payload.keys) {
    throw new Error("This recovery file is incomplete or from an unsupported version.");
  }
  const walletHex = payload.identity.startsWith("wallet:")
    ? payload.identity.slice("wallet:".length)
    : null;
  if (walletHex && !/^[0-9a-f]{64}$/i.test(walletHex)) {
    throw new Error("This recovery file has a malformed wallet identity.");
  }
  // Refuse rather than restore into the wrong pool. Importing it here would
  // succeed, show an empty vault, and give the member no reason to suspect the
  // file — which is the failure that costs them the funds they were restoring.
  if (payload.vault && currentVault && payload.vault !== currentVault) {
    throw new Error(
      `This file recovers your ${payload.vault} vault, but you are in the ${currentVault} vault. ` +
        `Switch to ${payload.vault} and restore it there — each vault has its own identity and its own file.`,
    );
  }
  return {
    payload: payload as VaultBackupPayload,
    solanaPublicKey: walletHex
      ? Uint8Array.from(Buffer.from(walletHex, "hex"))
      : new Uint8Array(32),
  };
}

export function createVaultBackupPayload(identity: string, vault?: string): VaultBackupPayload {
  const keys = UTXOpiaClient.instance().serializeKeys();
  if (!keys) {
    throw new Error("No vault keys available to back up.");
  }
  return {
    version: 1,
    app: "UTXOpia",
    warning: vault
      ? `This backup can recover your ${vault} UTXOpia vault, and only that one. Store it offline. Do not share it.`
      : "This backup can recover your private UTXOpia vault. Store it offline. Do not share it.",
    exportedAt: new Date().toISOString(),
    identity,
    ...(vault ? { vault } : {}),
    keys,
  };
}

export function downloadVaultBackup(identity: string, vault?: string): void {
  const payload = createVaultBackupPayload(identity, vault);
  const blob = new Blob([JSON.stringify(payload, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  // The vault goes in the filename because that is the only part a member sees
  // in their download folder six months later, at the moment they need it.
  link.download = `utxopia-${vault ? `${vault}-` : ""}vault-backup-${payload.exportedAt.slice(0, 10)}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function isPasskeyVault(keys: {
  solanaPublicKey?: Uint8Array | number[];
}): boolean {
  const pubkey = keys.solanaPublicKey;
  return !!pubkey && Array.from(pubkey).every((byte) => byte === 0);
}
