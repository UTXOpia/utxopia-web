"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import bs58 from "bs58";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { hrefWithChain, type NetworkId } from "@/lib/network-config";
import { cn } from "@/lib/utils";
import { SolanaAddressField } from "@/components/ui/solana-address-field";

type Status = "idle" | "signing" | "redeeming" | "done" | "error";

/**
 * Join the Verified Privacy vault with an invite code.
 *
 * This replaces the old "apply and wait for the operator" queue. A code admits
 * you outright, so admission stops depending on someone answering.
 *
 * Two things about the inputs are deliberate:
 *
 * - The Solana address is a field, and on testnet that is the default path. A
 *   signature proves the wallet is yours; typing an address proves nothing, so
 *   a typo that still decodes binds the membership to a key nobody holds and
 *   the registry has no remove instruction. That trade is deliberate while
 *   there is no value behind the membership, and the backend refuses it unless
 *   UTXOPIA_INVITE_ALLOW_UNSIGNED is set — so it cannot follow us to a network
 *   where a code in an inbox would be bearer value. Connecting a wallet still
 *   works and is still the safer route.
 * - The bitcoin address is optional here, and permanent if given. A Solana
 *   exit alone already recovers every SPL asset in the vault without anyone's
 *   approval; only converting zkBTC back to bitcoin needs a registered script.
 *   Demanding a permanent, unverifiable address at the most rushed moment a
 *   member has is a worse trade than letting them check and register one later
 *   — the registry has no remove instruction, so a wrong address stays wrong.
 */
export function RedeemInvite({
  networkId,
  initialCode,
  onRedeemed,
  showApplyLink = true,
  className,
}: {
  networkId: NetworkId;
  /** Lets the page own the "you're in" state. Without it the success message
   *  is a two-line box under a form, still sitting beneath the four things
   *  nobody can undo — a heading for a decision already made. */
  onRedeemed?: (registeredBtc: boolean) => void;
  /** Prefilled from `?code=` so the invite mail is one click. Never
   *  auto-submitted: redemption is permanent, and the four things nobody can
   *  undo are on the page above this form to be read first. */
  initialCode?: string;
  /** The /redeem page says this itself, in fuller words, outside the card.
   *  Everywhere else this component appears the prompt has nowhere else to go. */
  showApplyLink?: boolean;
  className?: string;
}) {
  const { publicKey, signMessage } = useWallet();
  const [code, setCode] = useState(initialCode ?? "");
  const [typedWallet, setTypedWallet] = useState("");
  const [btcAddress, setBtcAddress] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);
  // On regtest the test bitcoin comes from one faucet address, and that is the
  // address a deposit can be sent back to without asking anyone. Offering it
  // saves the user inventing a destination they do not control — and it is the
  // only one their faucet-funded deposits could ragequit to anyway.
  const [faucetAddress, setFaucetAddress] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/faucet/regtest", { cache: "no-store" })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && typeof body?.address === "string") setFaucetAddress(body.address);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const busy = status === "signing" || status === "redeeming";
  // A connected wallet signs; otherwise the typed address is what we register.
  const wallet = publicKey?.toBase58() ?? typedWallet.trim();
  // Base58 has no checksum, so this only catches a mistyped *length* — it is a
  // guard against an obviously wrong paste, not a proof of anything.
  const walletLooksValid = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(wallet);
  const ready = code.trim().length > 0 && walletLooksValid && !busy;

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
    if (!walletLooksValid) return;
    setError(null);
    try {
      // Signing only when there is a wallet that can. Without one the address
      // is sent as typed and the backend decides whether that is allowed.
      let signed: { nonce: string; signature: string } | null = null;
      if (publicKey && signMessage) {
        setStatus("signing");
        const challenge = await post("challenge", { wallet });
        // The message is taken verbatim from the server — rebuilding it in the
        // client would let the two drift and every signature would be rejected.
        signed = {
          nonce: challenge.nonce,
          signature: bs58.encode(
            await signMessage(new TextEncoder().encode(challenge.message)),
          ),
        };
      }

      setStatus("redeeming");
      await post("redeem", {
        code: code.trim(),
        wallet,
        ...(signed ?? {}),
        ...(btcAddress.trim() ? { btc_address: btcAddress.trim() } : {}),
      });
      setStatus("done");
      onRedeemed?.(!!btcAddress.trim());
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
          {btcAddress.trim()
            ? "Your wallet and bitcoin address are registered on chain. Try the deposit again."
            : "Your wallet is registered on chain. Add a bitcoin address before you rely on withdrawing bitcoin without us."}
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

      {!publicKey && (
        // No connected-wallet default here: this address is registered on chain
        // permanently, so it has to be an address the user consciously supplies
        // after reading the warning — not one the form filled in for them.
        <SolanaAddressField
          value={typedWallet}
          onChange={setTypedWallet}
          label="Your Solana address"
          placeholder="Paste the address that will be your membership"
          useConnectedWallet={false}
          disabled={busy}
          help="Paste it — do not type it. A Solana address has no checksum, so a wrong one that still looks valid registers your membership to a wallet nobody controls, permanently, and spends the code. Nothing can undo that."
        />
      )}

      <label className="flex flex-col gap-1">
        <span className="flex items-center justify-between gap-2 text-caption text-gray-light">
          <span>
            Bitcoin withdrawal address <span className="text-gray">(optional)</span>
          </span>
          {faucetAddress && !btcAddress.trim() && !busy && (
            <button
              type="button"
              onClick={() => setBtcAddress(faucetAddress)}
              className="text-caption text-privacy underline underline-offset-2 hover:opacity-80"
            >
              use the test faucet address
            </button>
          )}
        </span>
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
          Where you can withdraw bitcoin to <strong>without needing our approval</strong>. Written
          on chain permanently — it cannot be changed or removed, so check it twice. You can skip
          this and add one later; until you do, only bitcoin withdrawals need us.
        </span>
      </label>

      {publicKey ? (
        <p className="text-caption text-gray">
          Joining as <span className="font-mono">{publicKey.toBase58()}</span> — you&apos;ll be
          asked to sign a message to prove it&apos;s yours. It is not a transaction and moves nothing.
        </p>
      ) : (
        walletLooksValid && (
          <p className="text-caption leading-relaxed text-gray">
            Joining as <span className="font-mono break-all text-gray-light">{wallet}</span>. Read
            it back against your wallet before you press the button — this is the last moment it
            can be changed.
          </p>
        )
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
        disabled={!ready}
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

      {showApplyLink && (
        <p className="text-caption text-gray">
          Don&apos;t have a code?{" "}
          <Link
            href={hrefWithChain("/apply", networkId)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            Apply for a seat
          </Link>
          .
        </p>
      )}
    </div>
  );
}
