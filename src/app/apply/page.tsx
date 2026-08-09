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
 * The page used to lead with scarcity — a small cohort, most applications get
 * a no — which was true and was what let it work without a countdown or a
 * referral tree. It no longer is: applying issues a code. What has to carry the
 * page now is the same honesty pointed at the thing that is still permanent, so
 * nobody redeems on the assumption that admission can be undone.
 */
const HONEST = [
  {
    title: "Devnet only — nothing here is private.",
    body: "We collect full logs, addresses and failing state on purpose. That inverts before real money is involved.",
  },
  {
    title: "The ask is a condition, not a favour.",
    body: "Deposit, transfer and withdraw with our coordinator switched off, then tell us exactly what broke.",
  },
  {
    title: "Redeeming is permanent.",
    body: "Your code locks to the first wallet that uses it, and that writes an on-chain entry nobody can remove. Anyone can apply; nobody can undo it.",
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
              closed beta
            </span>
          </div>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            Apply for Verified Pools
          </h1>
          <p className="text-body2 leading-relaxed text-gray-light">
            A shielded vault on Solana. Deposit, transfer privately, and withdraw to your own
            registered address — without our approval. Apply and your code arrives by email. We
            want people to break it before it holds anything real.
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
