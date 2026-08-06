"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { useChainEnvironment } from "@/lib/chain-environment";
import { parsePoolFees, type PoolFees } from "@/lib/pool-fees";
import { derivePoolStatePDA } from "@/lib/solana/pdas";

export function usePoolFees() {
  const { connection } = useConnection();
  const chainEnv = useChainEnvironment();
  const [fees, setFees] = useState<PoolFees | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async (): Promise<PoolFees> => {
    setLoading(true);
    try {
      const programId = new PublicKey(chainEnv.config.solana.utxopiaProgramId);
      // Seed from the environment's mint, not the SDK default: on a dual-vault
      // network the default is whichever vault the SDK was configured for last,
      // so the fees shown could belong to the other pool.
      const [poolState] = derivePoolStatePDA(
        programId,
        new PublicKey(chainEnv.config.tokens.zkbtcMint),
      );
      const account = await connection.getAccountInfo(poolState, "confirmed");
      const parsed = account ? parsePoolFees(account.data) : null;
      if (!parsed) throw new Error("Pool fee configuration is unavailable.");
      setFees(parsed);
      setError(null);
      return parsed;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : "Could not load pool fees.";
      setError(message);
      throw cause;
    } finally {
      setLoading(false);
    }
  }, [chainEnv.config.solana.utxopiaProgramId, chainEnv.config.tokens.zkbtcMint, connection]);

  useEffect(() => {
    void refresh().catch(() => undefined);
  }, [refresh]);

  return { fees, loading, error, refresh };
}
