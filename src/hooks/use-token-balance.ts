import { useState, useEffect, useCallback } from "react";
import { PublicKey, LAMPORTS_PER_SOL, type Connection } from "@solana/web3.js";
import { BTC_MINER_FEE_ESTIMATE } from "@/lib/btc-constants";
import type { SupportedToken } from "@/lib/supported-tokens";

/**
 * Fetches SOL and SPL token balances based on the selected token,
 * and provides a handleMax() that returns the max amount string.
 */
export function useTokenBalance(
  selectedToken: SupportedToken,
  publicKey: PublicKey | null,
  connection: Connection,
  btcBalance: number | null,
  runtimeMint = "",
) {
  const [solBalance, setSolBalance] = useState<number | null>(null);
  const [splBalance, setSplBalance] = useState<number | null>(null);

  // Fetch SOL balance when SOL is selected
  useEffect(() => {
    if (!publicKey || !selectedToken.isSOL) {
      setSolBalance(null);
      return;
    }
    let cancelled = false;
    connection.getBalance(publicKey).then((bal) => {
      if (!cancelled) setSolBalance(bal);
    }).catch((err) => console.error("[TokenBalance] SOL balance fetch error:", err));
    return () => { cancelled = true; };
  }, [publicKey, selectedToken.isSOL, connection]);

  // Fetch SPL token balance for non-SOL, non-BTC tokens (USDC, USDT, zkBTC)
  useEffect(() => {
    const mint = selectedToken.mint || runtimeMint;
    if (!publicKey || selectedToken.isSOL || selectedToken.isBtcNative || !mint) {
      setSplBalance(null);
      return;
    }
    let cancelled = false;
    setSplBalance(null);
    const mintPubkey = new PublicKey(mint);
    connection.getTokenAccountsByOwner(publicKey, { mint: mintPubkey }).then((accounts) => {
      if (cancelled) return;
      if (accounts.value.length === 0) { setSplBalance(0); return; }
      // A wallet can own more than one account for the same mint. Token and
      // Token-2022 accounts share the same amount offset.
      const total = accounts.value.reduce((sum, tokenAccount) => {
        const data = tokenAccount.account.data;
        const view = new DataView(data.buffer, data.byteOffset + 64, 8);
        return sum + view.getBigUint64(0, true);
      }, 0n);
      setSplBalance(Number(total));
    }).catch((err) => {
      console.error("[TokenBalance] SPL balance fetch error:", err);
      // Keep the balance unknown on RPC failure. Showing zero would incorrectly
      // tell the user that a successfully connected wallet has no funds.
      if (!cancelled) setSplBalance(null);
    });
    return () => { cancelled = true; };
  }, [publicKey, selectedToken, connection, runtimeMint]);

  const handleMax = useCallback((): string => {
    if (selectedToken.isBtcNative && btcBalance !== null) {
      const maxSats = Math.max(0, btcBalance - BTC_MINER_FEE_ESTIMATE);
      return (maxSats / 1e8).toFixed(8);
    } else if (selectedToken.isSOL && solBalance !== null) {
      const maxLamports = Math.max(0, solBalance - 0.01 * LAMPORTS_PER_SOL);
      return (maxLamports / LAMPORTS_PER_SOL).toFixed(9);
    } else if (!selectedToken.isSOL && !selectedToken.isBtcNative && splBalance !== null) {
      const value = splBalance / (10 ** selectedToken.decimals);
      return value.toFixed(selectedToken.decimals);
    }
    return "0";
  }, [selectedToken, solBalance, splBalance, btcBalance]);

  return { solBalance, splBalance, handleMax };
}
