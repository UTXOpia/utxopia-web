"use client";

import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { ArrowRight, ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { WalletButton } from "@/components/ui";
import { RedeemInvite } from "@/components/redeem-invite";
import { useVerifiedMembership } from "@/hooks/use-verified-membership";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";
import { hrefWithVault, vaultsSupported } from "@/lib/vault-config";

/**
 * The URL that goes in the invite message.
 *
 * Until this existed the only way to redeem a code was to find a low-contrast
 * link inside the deposit form — an invite-gated beta whose admission step was
 * undiscoverable from any address you could put in a DM.
 *
 * The four irreversible facts are stated above the form rather than after it,
 * matching the invite message: everything permanent gets said before the code
 * is spent, because afterwards no one can take any of it back.
 */
const PERMANENT = [
  {
    title: "This is devnet, and nothing here is private yet.",
    body: "We collect aggressively in this phase on purpose — full logs, wallet addresses, failing state. That inverts completely before real money is involved.",
  },
  {
    title: "A bitcoin withdrawal address, once registered, is permanent.",
    body: "It cannot be changed or removed. It is optional below, and for this phase we suggest you skip it — a Solana exit already recovers every SPL asset without our approval.",
  },
  {
    title: "If you lose your recovery file, your notes are gone.",
    body: "Not \"contact support\" gone. Download the backup the moment you have one. A passkey is not a backup.",
  },
  {
    title: "Your code binds to the first wallet that redeems it.",
    body: "That wallet is your membership. It cannot be moved, and you cannot redeem a second code.",
  },
];

export default function RedeemPage() {
  const { networkId } = useChainEnvironment();
  const { publicKey } = useWallet();
  const membership = useVerifiedMembership();

  const depositHref = hrefWithChain(
    hrefWithVault("/vault/deposit", "verified"),
    networkId,
  );

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 pb-16 pt-28 sm:px-6 sm:pt-32">
        <div className="mb-8">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-gray/15 bg-muted/20 px-3 py-1.5">
            <ShieldCheck className="h-3.5 w-3.5 text-privacy" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-gray">
              Verified Privacy · closed beta
            </span>
          </div>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Redeem your invite code
          </h1>
          <p className="text-body2 leading-relaxed text-gray-light">
            Connect the wallet you want to be your membership, paste the code, and sign the message
            it shows you. The signature is not a transaction and moves nothing.
          </p>
        </div>

        {!vaultsSupported(networkId) ? (
          <div className="rounded-[14px] border border-warning/25 bg-warning/5 p-4 text-caption text-gray-light">
            The Verified vault is not deployed on this network. Switch to UTXOpia Devnet and try
            again — your code is unaffected.
          </div>
        ) : membership === "member" ? (
          <div className="rounded-[20px] border border-privacy/25 bg-privacy/5 p-5 sm:p-6">
            <h2 className="mb-1 text-body1 font-semibold text-foreground">You&apos;re already in.</h2>
            <p className="mb-4 text-caption leading-relaxed text-gray-light">
              This wallet is registered on chain as a member. A code is one per wallet, so there is
              nothing left to redeem here.
            </p>
            <Link
              href={depositHref}
              className="inline-flex min-h-10 items-center gap-2 rounded-[10px] bg-foreground px-4 text-caption font-semibold text-background transition-colors hover:bg-white"
            >
              Add funds to the Verified vault
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        ) : (
          <>
            <div className="mb-6 space-y-3">
              <p className="text-caption font-semibold uppercase tracking-wider text-gray/60">
                Read this before you redeem — four things nobody can undo
              </p>
              {PERMANENT.map((item) => (
                <div
                  key={item.title}
                  className="rounded-[12px] border border-gray/15 bg-muted/30 px-4 py-3"
                >
                  <p className="text-caption font-semibold text-foreground">{item.title}</p>
                  <p className="mt-1 text-caption leading-relaxed text-gray">{item.body}</p>
                </div>
              ))}
            </div>

            <div className="rounded-[20px] border border-gray/20 bg-card/60 p-5 sm:p-6">
              {publicKey ? (
                <RedeemInvite networkId={networkId} />
              ) : (
                <div className="flex flex-col items-start gap-3">
                  <p className="text-caption text-gray-light">
                    Connect the wallet that will hold your membership. It cannot be changed later.
                  </p>
                  <WalletButton />
                </div>
              )}
            </div>
          </>
        )}

        <p className="mt-6 text-caption text-gray">
          Code expired, or something not working?{" "}
          <Link
            href={hrefWithChain("/feedback", networkId)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            Tell us
          </Link>{" "}
          — expiry is a free re-confirmation checkpoint, not a rejection, and we will reissue.
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
