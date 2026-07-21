"use client";

// Config-driven; a chain-state fetch can replace/augment this later.

import { useMemo } from "react";
import { useChainEnvironment } from "@/lib/chain-environment";

export interface PoolPermissionedInfo {
  permissioned: boolean;
  /** Decoded auditor viewing pubkey bytes, if configured. */
  auditorViewingPubkey?: Uint8Array;
  /** Sui AuditorCap object ID, if configured (Sui pools only). */
  auditorCapId?: string;
}

function hexToBytes(hex: string): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const len = Math.floor(clean.length / 2);
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  }
  return out;
}

// Minimal base58 decode for 32-byte Solana pubkeys.
const BASE58_ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
function base58ToBytes(s: string): Uint8Array {
  let num = BigInt(0);
  for (const ch of s) {
    const idx = BASE58_ALPHABET.indexOf(ch);
    if (idx === -1) throw new Error(`Invalid base58 char: ${ch}`);
    num = num * BigInt(58) + BigInt(idx);
  }
  const hex = num.toString(16).padStart(64, "0");
  return hexToBytes(hex);
}

export function usePoolPermissioned(): PoolPermissionedInfo {
  const { config } = useChainEnvironment();

  return useMemo<PoolPermissionedInfo>(() => {
    if (config.solana?.permissioned) {
      const pkBase58 = config.solana.auditorViewingPubkey;
      let auditorViewingPubkey: Uint8Array | undefined;
      if (pkBase58) {
        try {
          auditorViewingPubkey = base58ToBytes(pkBase58);
        } catch {
          // Malformed key — treat as absent but still permissioned.
        }
      }
      return { permissioned: true, auditorViewingPubkey };
    }

    return { permissioned: false };
  }, [config]);
}
