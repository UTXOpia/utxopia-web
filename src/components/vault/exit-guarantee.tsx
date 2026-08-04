"use client";

import { useCallback, useEffect, useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { AlertCircle, Check, Loader2, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { hasBtcExit, hasSolanaExit, type BtcNetwork } from "@/lib/exit-registry";

type Check = "unknown" | "checking" | "yes" | "no" | "invalid";

/**
 * What you can still withdraw if the operator disappears.
 *
 * Read from Solana, never from the backend — the whole question is what holds
 * without them, so asking them would be circular.
 *
 * The two rows are genuinely different guarantees. A Solana exit recovers every
 * SPL asset in the vault unilaterally, and every member gets one on joining.
 * zkBTC comes out the same way, but converting it back to bitcoin needs either
 * an approval or a registered bitcoin address — so without one you are never
 * trapped, you can just end up holding a claim you cannot convert.
 *
 * The registry is keyed by destination rather than by member, so there is no
 * on-chain question "does this member have a bitcoin exit". You can only ask
 * about a specific address, which is why this asks you to name one.
 */
export function ExitGuarantee({
  programId,
  poolState,
  btcNetwork,
  onRegister,
  className,
}: {
  programId: string;
  poolState: string;
  btcNetwork: BtcNetwork;
  /** Opens whatever flow registers a new destination; omit to hide the prompt. */
  onRegister?: (address: string) => void;
  className?: string;
}) {
  const { connection } = useConnection();
  const { publicKey } = useWallet();
  const [solana, setSolana] = useState<Check>("unknown");
  const [address, setAddress] = useState("");
  const [btc, setBtc] = useState<Check>("unknown");

  useEffect(() => {
    if (!publicKey) return setSolana("unknown");
    let cancelled = false;
    setSolana("checking");
    hasSolanaExit(connection, new PublicKey(programId), new PublicKey(poolState), publicKey)
      .then((ok) => { if (!cancelled) setSolana(ok ? "yes" : "no"); })
      .catch(() => { if (!cancelled) setSolana("unknown"); });
    return () => { cancelled = true; };
  }, [connection, programId, poolState, publicKey]);

  const checkBtc = useCallback(async () => {
    if (!address.trim()) return;
    setBtc("checking");
    try {
      const ok = await hasBtcExit(
        connection, new PublicKey(programId), new PublicKey(poolState), address, btcNetwork,
      );
      setBtc(ok ? "yes" : "no");
    } catch {
      // A malformed address cannot be checked, and must not read as "no".
      setBtc("invalid");
    }
  }, [address, btcNetwork, connection, programId, poolState]);

  return (
    <div className={cn("flex flex-col gap-3 rounded-[10px] border border-gray/15 bg-muted p-3", className)}>
      <div className="flex items-start gap-2">
        {solana === "yes"
          ? <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-privacy" aria-hidden />
          : <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-gray" aria-hidden />}
        <div className="flex flex-col gap-0.5">
          <span className="text-caption font-semibold text-foreground">
            If we disappear, you can still withdraw
          </span>
          <span className="text-caption text-gray-light">
            {solana === "checking" && "Checking on chain…"}
            {solana === "yes" && "USDC, USDT and SOL come back to your wallet without anyone's approval."}
            {solana === "no" && "This wallet has no registered exit yet — redeem an invite code first."}
            {solana === "unknown" && "Connect a wallet to check."}
          </span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-gray/15 pt-3">
        <span className="text-caption text-gray-light">
          Bitcoin is the exception. Check an address before you rely on it:
        </span>
        <div className="flex gap-1.5">
          <input
            value={address}
            onChange={(event) => { setAddress(event.target.value); setBtc("unknown"); }}
            placeholder="bc1…"
            autoComplete="off"
            spellCheck={false}
            className={cn(
              "min-h-9 flex-1 rounded-[10px] border border-gray/20 bg-transparent px-3 py-1.5",
              "font-mono text-caption text-foreground placeholder:text-gray",
              "focus:border-gray/40 focus:outline-none",
            )}
          />
          <button
            type="button"
            onClick={checkBtc}
            disabled={!address.trim() || btc === "checking"}
            className={cn(
              "min-h-9 shrink-0 rounded-[10px] border border-gray/20 px-3 text-caption font-semibold",
              "text-foreground transition-colors hover:border-gray/40",
              "disabled:cursor-not-allowed disabled:opacity-60",
            )}
          >
            {btc === "checking" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : "Check"}
          </button>
        </div>

        {btc === "yes" && (
          <span className="flex items-center gap-1.5 text-caption text-privacy">
            <Check className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Registered — bitcoin can be withdrawn here with no approval.
          </span>
        )}
        {btc === "invalid" && (
          <span className="flex items-center gap-1.5 text-caption text-red-400">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" aria-hidden />
            Not a valid bitcoin address for this network.
          </span>
        )}
        {btc === "no" && (
          <div className="flex flex-col gap-1.5">
            <span className="flex items-center gap-1.5 text-caption text-gray-light">
              <AlertCircle className="h-3.5 w-3.5 shrink-0 text-gray" aria-hidden />
              Not registered. Withdrawing bitcoin here would need our approval.
            </span>
            {onRegister && (
              <button
                type="button"
                onClick={() => onRegister(address.trim())}
                className={cn(
                  "min-h-9 rounded-[10px] border border-gray/20 px-3 text-caption font-semibold",
                  "text-foreground transition-colors hover:border-gray/40",
                )}
              >
                Register this address permanently
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
