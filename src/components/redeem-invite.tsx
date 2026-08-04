"use client";

import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type Status = "idle" | "signing" | "redeeming" | "done" | "error";

/**
 * Join the Verified Privacy vault with an invite code.
 *
 * This replaces the old "apply and wait for the operator" queue. A code admits
 * you outright, so admission stops depending on someone answering.
 *
 * Two things about the inputs are deliberate:
 *
 * - The Solana address is not a field. Redemption is authorised by signing a
 *   server-issued nonce with the connected wallet, so it can only ever be the
 *   wallet in front of us. Letting someone type an address they cannot sign for
 *   is exactly the hole that signature closes.
 * - The bitcoin address is required, and permanent. It registers the
 *   destination a withdrawal can reach *without* the operator's approval —
 *   which is what keeps the vault non-custodial for you — and the on-chain
 *   registry has no remove instruction, so a wrong address stays wrong.
 */
export function RedeemInvite({
  networkId,
  className,
}: {
  networkId: string;
  className?: string;
}) {
  const { publicKey, signMessage } = useWallet();
  const [code, setCode] = useState("");
  const [btcAddress, setBtcAddress] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = status === "signing" || status === "redeeming";
  const ready = code.trim().length > 0 && btcAddress.trim().length > 0 && !busy;

  const post = async (action: string, body: unknown) => {
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
  };

  const redeem = async () => {
    if (!publicKey || !signMessage) return;
    setError(null);
    try {
      setStatus("signing");
      const wallet = publicKey.toBase58();
      const challenge = await post("challenge", { wallet });
      // The message is taken verbatim from the server — rebuilding it in the
      // client would let the two drift and every signature would be rejected.
      const signature = bs58.encode(
        await signMessage(new TextEncoder().encode(challenge.message)),
      );

      setStatus("redeeming");
      await post("redeem", {
        code: code.trim(),
        wallet,
        nonce: challenge.nonce,
        signature,
        btc_address: btcAddress.trim(),
      });
      setStatus("done");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not redeem this code");
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div
        className={cn(
          "flex items-start gap-2 rounded-[10px] border border-gray/15 bg-muted px-3 py-2.5 text-caption text-gray-light",
          className,
        )}
        role="status"
      >
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-privacy" aria-hidden />
        <span>
          <strong className="text-foreground">You&apos;re in.</strong>{" "}
          Your wallet and bitcoin address are registered on chain. Try the deposit again.
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-2", className)}>
      <label className="flex flex-col gap-1">
        <span className="text-caption text-gray-light">Invite code</span>
        <input
          value={code}
          onChange={(event) => setCode(event.target.value)}
          placeholder="XXXXX-XXXXX-XXXXX-XXXXX"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          className={cn(
            "min-h-10 rounded-[10px] border border-gray/20 bg-transparent px-3 py-2",
            "font-mono text-caption text-foreground placeholder:text-gray",
            "focus:border-gray/40 focus:outline-none disabled:opacity-60",
          )}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-caption text-gray-light">Bitcoin withdrawal address</span>
        <input
          value={btcAddress}
          onChange={(event) => setBtcAddress(event.target.value)}
          placeholder="bc1…"
          autoComplete="off"
          spellCheck={false}
          disabled={busy}
          className={cn(
            "min-h-10 rounded-[10px] border border-gray/20 bg-transparent px-3 py-2",
            "font-mono text-caption text-foreground placeholder:text-gray",
            "focus:border-gray/40 focus:outline-none disabled:opacity-60",
          )}
        />
        <span className="text-caption text-gray">
          This is where you can withdraw bitcoin to <strong>without needing approval</strong>.
          It is written on chain permanently and cannot be changed or removed — check it twice.
        </span>
      </label>

      {publicKey && (
        <p className="text-caption text-gray">
          Joining as <span className="font-mono">{publicKey.toBase58()}</span> — you&apos;ll be
          asked to sign a message to prove it&apos;s yours. It is not a transaction and moves nothing.
        </p>
      )}

      {status === "error" && error && (
        <div className="flex items-center gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-3">
          <AlertCircle className="h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <span className="text-caption text-red-400">{error}</span>
        </div>
      )}

      <button
        type="button"
        onClick={redeem}
        disabled={!ready || !publicKey || !signMessage}
        className={cn(
          "flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-gray/20",
          "px-3 py-2.5 text-caption font-semibold text-foreground transition-colors",
          "hover:border-gray/40 disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {status === "signing" ? "Waiting for your signature…"
          : status === "redeeming" ? "Registering on chain…"
          : "Redeem invite code"}
      </button>
    </div>
  );
}
