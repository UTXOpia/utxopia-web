"use client";

import Link from "next/link";
import { ArrowLeft, MessagesSquare } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { FeedbackForm, FEEDBACK_EMAIL } from "@/components/feedback/feedback-form";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";

/**
 * Standalone feedback page — the URL that goes in the invite message, so a
 * member who has closed the app still has somewhere to send a report from.
 * The floating widget covers everything else.
 */
export default function FeedbackPage() {
  const { networkId } = useChainEnvironment();

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 pb-16 pt-28 sm:px-6 sm:pt-32">
        <Link
          href={hrefWithChain("/vault", networkId)}
          className="mb-4 inline-flex items-center gap-2 text-body2 text-gray transition-colors hover:text-gray-light"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to vault
        </Link>

        <div className="mb-8">
          <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-gray/15 bg-muted/20 px-3 py-1.5">
            <MessagesSquare className="h-3.5 w-3.5 text-gray-light" />
            <span className="text-[10px] font-medium uppercase tracking-wider text-gray">
              Closed beta
            </span>
          </div>
          <h1 className="mb-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            What did we get wrong?
          </h1>
          <p className="text-body2 leading-relaxed text-gray-light">
            You are one of a small number of people using this before anyone else, on testnet, where
            nothing is at risk. The cohort is small enough that every report is read by the person
            who can fix it — there is no queue and no triage tier.
          </p>
        </div>

        <div className="rounded-[20px] border border-gray/20 bg-card/60 p-5 sm:p-6">
          <FeedbackForm />
        </div>

        <div className="mt-6 space-y-2 text-caption text-gray">
          <p>
            <strong className="text-gray-light">Rather email?</strong>{" "}
            <a className="underline underline-offset-4 hover:text-foreground" href={`mailto:${FEEDBACK_EMAIL}`}>
              {FEEDBACK_EMAIL}
            </a>{" "}
            reaches the same place.
          </p>
          <p>
            <strong className="text-gray-light">Found something that loses funds?</strong> Say so in
            the first line and we will treat it as an incident rather than a ticket. Testnet or not,
            that class of bug is the reason this cohort exists.
          </p>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
