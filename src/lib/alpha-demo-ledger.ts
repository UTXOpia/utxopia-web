"use client";

import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, hexToBytes } from "@utxopia/sdk";
import type { InboxNote } from "@/stores/utxopia-store";

const STORAGE_KEY = "utxopia:alpha-demo-ledger:v1";
export const ALPHA_DEMO_NAME_EVENT = "utxopia:alpha-demo-name";

interface AlphaDemoDeposit {
  id: string;
  networkId: string;
  stealthAddress: string;
  amountSats: number;
  txid: string;
  opReturn?: string;
  createdAt: number;
}

interface AlphaDemoLedger {
  deposits: AlphaDemoDeposit[];
  names?: AlphaDemoName[];
}

interface AlphaDemoName {
  networkId: string;
  handle: string;
  ownerAddress: string;
  viewingPubKeyHex: string;
  mpkHex: string;
  createdAt: number;
}

export function alphaDemoLedgerEnabled(networkId: string): boolean {
  return (
    process.env.NEXT_PUBLIC_DEV_SIGNER === "1" &&
    process.env.NEXT_PUBLIC_DISABLE_ALPHA_DEMO_TX !== "1" &&
    !networkId.includes("mainnet")
  );
}

function readLedger(): AlphaDemoLedger {
  if (typeof window === "undefined") return { deposits: [] };
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || "{}") as Partial<AlphaDemoLedger>;
    return {
      deposits: Array.isArray(parsed.deposits) ? parsed.deposits : [],
      names: Array.isArray(parsed.names) ? parsed.names : [],
    };
  } catch {
    return { deposits: [], names: [] };
  }
}

function writeLedger(ledger: AlphaDemoLedger): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ledger));
  } catch {
    // Demo-only persistence; ignore quota/private-mode failures.
  }
}

export function recordAlphaDemoDeposit(input: {
  networkId: string;
  stealthAddress: string;
  amountSats: number;
  txid: string;
  opReturn?: string;
}): void {
  if (!alphaDemoLedgerEnabled(input.networkId)) return;
  const txid = input.txid || `local-${Date.now()}`;
  const id = `${input.networkId}:${input.stealthAddress}:${txid}`;
  const ledger = readLedger();
  const deposits = ledger.deposits.filter((deposit) => deposit.id !== id);
  deposits.push({
    id,
    networkId: input.networkId,
    stealthAddress: input.stealthAddress,
    amountSats: input.amountSats,
    txid,
    opReturn: input.opReturn,
    createdAt: Date.now(),
  });
  writeLedger({ ...ledger, deposits: deposits.slice(-20) });
}

export function getAlphaDemoInboxNotes(networkId: string, stealthAddress: string | null): InboxNote[] {
  if (!stealthAddress || !alphaDemoLedgerEnabled(networkId)) return [];
  return getAlphaDemoNetworkInboxNotes(networkId, stealthAddress);
}

export function getAlphaDemoNetworkInboxNotes(networkId: string, stealthAddress?: string | null): InboxNote[] {
  if (!alphaDemoLedgerEnabled(networkId)) return [];
  return readLedger()
    .deposits
    .filter((deposit) => {
      if (deposit.networkId !== networkId) return false;
      return !stealthAddress || deposit.stealthAddress === stealthAddress;
    })
    .map((deposit, index) => {
      const seed = new TextEncoder().encode(`${deposit.id}:${deposit.opReturn ?? ""}`);
      const commitment = sha256(seed);
      const commitmentHex = bytesToHex(commitment);
      const ephemeralPub = deposit.opReturn && deposit.opReturn.length >= 82
        ? hexToBytes(deposit.opReturn.slice(18, 82))
        : commitment.slice(0, 32);

      return {
        id: `alpha-demo-${commitmentHex.slice(0, 16)}`,
        amount: BigInt(Math.max(0, Math.trunc(deposit.amountSats))),
        ephemeralPub,
        leafIndex: 900_000 + index,
        commitment,
        createdAt: deposit.createdAt,
        commitmentHex,
        isSpent: false,
        tokenSymbol: "zkBTC",
      };
    });
}

export function recordAlphaDemoName(input: {
  networkId: string;
  handle: string;
  ownerAddress: string;
  viewingPubKey: Uint8Array;
  mpk: Uint8Array;
}): void {
  if (!alphaDemoLedgerEnabled(input.networkId)) return;
  const handle = input.handle.trim().toLowerCase();
  const ledger = readLedger();
  const names = (ledger.names ?? []).filter(
    (name) => !(name.networkId === input.networkId && name.handle === handle),
  );
  names.push({
    networkId: input.networkId,
    handle,
    ownerAddress: input.ownerAddress,
    viewingPubKeyHex: bytesToHex(input.viewingPubKey),
    mpkHex: bytesToHex(input.mpk),
    createdAt: Date.now(),
  });
  writeLedger({ ...ledger, names: names.slice(-50) });
  window.dispatchEvent(new CustomEvent(ALPHA_DEMO_NAME_EVENT, { detail: { handle } }));
}

export function getAlphaDemoNameForOwner(networkId: string, ownerAddress: string | null): AlphaDemoName | null {
  if (!ownerAddress || !alphaDemoLedgerEnabled(networkId)) return null;
  return (readLedger().names ?? [])
    .filter((name) => name.networkId === networkId && name.ownerAddress === ownerAddress)
    .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
}

export function getAlphaDemoName(networkId: string, handle: string): AlphaDemoName | null {
  if (!alphaDemoLedgerEnabled(networkId)) return null;
  const normalized = handle.trim().toLowerCase().replace(/^@/, "").replace(/\.utxopia\.sol$/, "");
  return (readLedger().names ?? []).find(
    (name) => name.networkId === networkId && name.handle === normalized,
  ) ?? null;
}

export function resolveAlphaDemoName(networkId: string, handle: string) {
  const name = getAlphaDemoName(networkId, handle);
  if (!name) return null;
  return {
    viewingPubKey: hexToBytes(name.viewingPubKeyHex),
    mpk: hexToBytes(name.mpkHex),
    complianceFlags: 0,
  };
}
