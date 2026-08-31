"use client";

import { useState } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { Check, Loader2, ShieldAlert } from "lucide-react";
import { hasBtcExit, type BtcNetwork } from "@/lib/exit-registry";
import { WalletButton } from "@/components/ui/wallet-button";
import { cn } from "@/lib/utils";

type Phase = "asking" | "checking" | "registering" | "ready";

/**
 * Register the bitcoin address a deposit will be paid from, before handing out
 * anywhere to pay.
 *
 * The tracker holds a deposit whose sending address has no registered exit
 * (BTC_REQUIRE_REGISTERED_EXIT) — the invariant is that value never enters
 * without a way out, and for BTC the sending address is the only identity
 * available. So this is not a form to fill in later: an unregistered payment is
 * one someone has to go and un-hold by hand.
 *
 * The registry is keyed by destination, so the only answerable question is
 * "is THIS address registered". That is why it asks for the address rather than
 * telling the member whether they are covered.
 */
export function BtcExitGate({
  programId,
  poolState,
  btcNetwork,
  networkId,
  onReady,
  className,
}: {
  programId: string;
  poolState: string;
  btcNetwork: BtcNetwork;
  networkId: string;
  /** Called with the address once it is registered — the address the member
   *  must then actually pay from. */
  onReady: (address: string) => void;
  className?: string;
}) {
  const { connection } = useConnection();
  const { publicKey, signMessage } = useWallet();
  const [address, setAddress] = useState("");
  const [phase, setPhase] = useState<Phase>("asking");
  const [error, setError] = useState<string | null>(null);

  const busy = phase === "checking" || phase === "registering";
  const canSign = Boolean(publicKey && signMessage);

  async function post(action: string, body: unknown) {
    const response = await fetch(
      `/api/invite/${action}?network=${encodeURIComponent(networkId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    const parsed = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(
        typeof parsed?.error === "string" ? parsed.error : `${action} failed (${response.status})`,
      );
    }
    return parsed;
  }

  async function submit() {
    const btcAddress = address.trim();
    if (!btcAddress) return;
    setError(null);
    setPhase("checking");
    try {
      // Ask the chain first: a member who redeemed their code with this address
      // is already registered, and re-registering costs the operator a
      // transaction to create an account that exists.
      const registered = await hasBtcExit(
        connection,
        new PublicKey(programId),
        new PublicKey(poolState),
        btcAddress,
        btcNetwork,
      );
      if (registered) {
        setPhase("ready");
        onReady(btcAddress);
        return;
      }

      if (!publicKey || !signMessage) {
        throw new Error("connect the wallet you redeemed your invite with to register this address");
      }
      setPhase("registering");
      const challenge = await post("challenge", { wallet: publicKey.toBase58() });
      // Verbatim from the server — rebuilding the message here would let the two
      // drift and every signature would be rejected.
      const signature = bs58.encode(
        await signMessage(new TextEncoder().encode(challenge.message)),
      );
      await post("btc-destination", {
        wallet: publicKey.toBase58(),
        nonce: challenge.nonce,
        signature,
        btc_address: btcAddress,
      });
      setPhase("ready");
      onReady(btcAddress);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "could not register this address");
      setPhase("asking");
    }
  }

  if (phase === "ready") {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-[10px] border border-success/25 bg-success/5 p-3 text-caption text-success",
          className,
        )}
        role="status"
      >
        <Check className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
        <span>
          <strong>{address.trim()}</strong> is registered. Pay from this address — a
          deposit from anywhere else is held until its sender is registered too.
        </span>
      </div>
    );
  }

  return (
    <div className={cn("space-y-3 rounded-[12px] border border-warning/20 bg-warning/5 p-4", className)}>
      <div className="flex items-start gap-3">
        <div className="mt-0.5 rounded-[9px] bg-warning/10 p-2">
          <ShieldAlert className="h-4 w-4 text-warning" />
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-body2-semibold text-foreground">Register where you&apos;ll pay from</p>
          <p className="mt-1 text-caption text-gray">
            Bitcoin only enters this vault from an address it can leave to. Name the
            address you will send from and it becomes a destination you can withdraw
            to later without asking anyone.
          </p>
        </div>
      </div>

      <label className="block">
        <span className="mb-1 block pl-2 text-body2 text-gray-light">Your bitcoin address</span>
        <input
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          placeholder={btcNetwork === "mainnet" ? "bc1…" : "tb1…"}
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          className={cn(
            "w-full rounded-[12px] border border-gray/15 bg-muted p-3",
            "font-mono text-caption text-foreground",
            "outline-none transition-colors focus:border-warning/40",
          )}
        />
      </label>

      {!canSign && (
        <div className="space-y-2">
          <p className="text-caption text-gray">
            Registering is signed by the wallet you redeemed your invite with. It
            proves the wallet is yours — no transaction, no fee, we cover the
            on-chain registration.
          </p>
          <div className="wallet-cta w-full">
            <WalletButton label="Connect wallet" />
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={busy || !address.trim()}
        className="btn-primary w-full"
      >
        {busy ? (
          <>
            <Loader2 className="h-4 w-4 animate-spin" />
            {phase === "checking" ? "Checking the registry…" : "Registering…"}
          </>
        ) : (
          "Use this address"
        )}
      </button>

      <p className="pl-1 text-caption text-gray">
        Permanent: the registry has no remove instruction. It is only ever somewhere
        your own coins can go, so a wrong address costs you a slot, not your funds —
        but it cannot be taken back.
      </p>

      {error && (
        <div className="rounded-[10px] border border-error/30 bg-error/5 p-3 text-caption text-error">
          {error}
        </div>
      )}
    </div>
  );
}
