"use client";

import Link from "next/link";
import { ShieldCheck } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ApplyForm } from "@/components/apply-form";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";

/**
 * The CTA for every public post. Posts never carry a code — a code is spent by
 * whoever redeems it first and admission is a permanent on-chain registration,
 * so a code in a public channel is a cohort with no upper bound.
 *
 * The scarcity stated here is real (15 seats, most applications get a no), and
 * saying so plainly is what lets the page do its work without a countdown, a
 * queue position, or a referral tree.
 */
const HONEST = [
  {
    title: "It is devnet, and nothing you do here is private.",
    body: "We collect aggressively in this phase on purpose — full logs, addresses, failing state. That inverts completely before real money is involved, and we would rather you hear it now than read it later.",
  },
  {
    title: "The ask is a condition, not a favour.",
    body: "Deposit, transfer, and withdraw while our coordinator is switched off — then tell us exactly what broke. If that sounds like work, it is; that is the whole point of the cohort.",
  },
  {
    title: "Fifteen seats, and most applications get a no.",
    body: "Not a growth tactic. Every admission writes a permanent entry on chain that nobody can remove, so a cohort is a thing you choose once.",
  },
];

export default function ApplyPage() {
  const { networkId } = useChainEnvironment();

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
            Apply for the closed beta
          </h1>
          <p className="text-body2 leading-relaxed text-gray-light">
            A shielded vault on Solana: deposit, transfer privately, and withdraw to your own
            registered address without our approval. We are looking for fifteen people to break it
            before there is anything real inside.
          </p>
        </div>

        <div className="mb-8 space-y-3">
          {HONEST.map((item) => (
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
          <ApplyForm />
        </div>

        <p className="mt-6 text-caption text-gray">
          Already have a code?{" "}
          <Link
            href={hrefWithChain("/redeem", networkId)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            Redeem it here
          </Link>
          .
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
