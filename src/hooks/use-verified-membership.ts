"use client";

import { useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { hasSolanaExit } from "@/lib/exit-registry";
import { getVaultRuntimeConfig, vaultsSupported } from "@/lib/vault-config";
import { useChainEnvironment } from "@/lib/chain-environment";

export type MembershipStatus = "unknown" | "checking" | "member" | "not-member";

/**
 * Is the connected wallet a member of the Verified vault?
 *
 * Redeeming an invite registers a Solana exit destination for the wallet, so
 * that PDA existing *is* the membership — which means this can be read from the
 * chain rather than asked of the backend. That matters twice over: it is the one
 * claim a member should never take the operator's word for, and it keeps
 * membership off any public HTTP surface we would otherwise have to proxy.
 */
export function useVerifiedMembership(): MembershipStatus {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const { networkId } = useChainEnvironment();
  const [status, setStatus] = useState<MembershipStatus>("unknown");

  useEffect(() => {
    if (!publicKey || !vaultsSupported(networkId)) {
      setStatus("unknown");
      return;
    }

    let cancelled = false;
    setStatus("checking");

    const vault = getVaultRuntimeConfig(networkId, "verified");
    hasSolanaExit(
      connection,
      new PublicKey(vault.programId),
      new PublicKey(vault.poolState),
      publicKey,
    )
      .then((ok) => { if (!cancelled) setStatus(ok ? "member" : "not-member"); })
      // An RPC failure is not evidence of non-membership. Staying "unknown"
      // leaves the caller free to fall back rather than hide a vault the member
      // is entitled to.
      .catch(() => { if (!cancelled) setStatus("unknown"); });

    return () => { cancelled = true; };
  }, [connection, publicKey, networkId]);

  return status;
}
