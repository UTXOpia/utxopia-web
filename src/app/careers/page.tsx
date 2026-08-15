"use client";

import Link from "next/link";
import { Download, Mail, Presentation, Send } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DeckEmbed } from "@/components/deck/deck-embed";
import { CONTACT_EMAIL, DATA_CHECKED, DECK_PDF_URL, TELEGRAM, TELEGRAM_URL } from "@/lib/contact";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";

/**
 * One open role. The page is deliberately short — the deck is the long version,
 * and a cofounder posting that takes ten minutes to read is already a bad sign.
 * The one rule it keeps: every number carries its source and the date it was
 * checked, or it doesn't go on the page.
 */

const FACTS = [
  ["Role", "Cofounder — growth, communications, distribution"],
  ["Compensation", "Equity only. No salary until we raise."],
  ["Equity", "Cofounder-level, a number in the first call"],
  ["Location", "Remote"],
  ["Stage", "Devnet, public alpha, pre-seed, pre-revenue"],
  ["Team", "One technical founder. You'd be the second."],
] as const;

const RESPONSIBILITIES = [
  ["Own how this gets explained", "Turn hard technical results into writing people trust."],
  ["Turn early users into proof", "People break this on devnet daily. Make that visible to strangers."],
  ["Own distribution", "Bitcoin holders, and the desks holding bitcoin for other people."],
  ["Raise beside me", "In the room with an equal say — not building the deck for me."],
];

const FIT = [
  "You've written something that changed someone's mind.",
  "You've put a product in front of strangers and got them to use it.",
  "You can talk to a bitcoin holder or an allocator without bluffing on the tech.",
  "You want ownership, and you can go without salary until we raise.",
];

const NOT_FIT = [
  "You want a defined scope and someone to approve it.",
  "Your growth playbook starts with points, airdrops or paid influencers.",
  "You need salary certainty now — reasonable, just not this.",
];

const APPLY = [
  "Something you wrote that changed someone's mind.",
  "One thing on this page, or in the deck, that's wrong or overclaimed.",
  "What you'd do in your first 30 days.",
];

const SOURCES = [
  {
    label: "Spark — BTCFi in 2026",
    href: "https://www.spark.money/research/btcfi-bitcoin-defi-landscape-2026",
  },
  { label: "DefiLlama — chain TVL", href: "https://defillama.com/chains" },
];

/** Prose measure. Wider than this and the eye loses the line. */
const PROSE = "max-w-[65ch]";

export default function CareersPage() {
  const { networkId } = useChainEnvironment();

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto max-w-6xl px-4 pb-20 pt-28 sm:px-6 sm:pt-32 2xl:max-w-7xl">
        {/* ── Posting header + facts rail ──
            Source order is the mobile order: headline, then the facts, then the
            two ways to reply. On lg the rail is placed into column two, so it
            sits beside the argument instead of interrupting it. */}
        <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_19rem] lg:gap-12 2xl:grid-cols-[minmax(0,1fr)_21rem] 2xl:gap-16">
          <div className="lg:col-start-1 lg:row-start-1">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-gray/15 bg-muted/20 px-3 py-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-btc" />
              <span className="text-[10px] font-medium uppercase tracking-wider text-gray">
                one open role
              </span>
            </div>

            <h1 className="mb-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl lg:text-4xl">
              Cofounder — everything that isn&apos;t code
            </h1>
            <p className={`text-body2 leading-relaxed text-gray-light ${PROSE}`}>
              The code works. Everything that isn&apos;t code, doesn&apos;t. No salary, because
              there is no money yet — real equity, an equal say, and a raise we walk into together.
            </p>

            {/* ── Why the role exists. Every figure sourced and dated. ── */}
            <h2 className="mb-3 mt-10 text-heading6 font-semibold text-foreground">
              Why this role exists
            </h2>

            <div className={`space-y-3 text-body2 leading-relaxed text-gray-light ${PROSE}`}>
              <p>
                Bitcoin is the largest pool of capital in crypto and almost none of it does
                anything: <span className="text-foreground">0.46% of supply</span> is deployed in
                bitcoin DeFi, against roughly{" "}
                <span className="text-foreground">15% of circulating ETH</span> in Ethereum DeFi.
                BTCFi TVL peaked near <span className="text-foreground">$9.1B in October 2025</span>{" "}
                and L2 and sidechain TVL has since contracted{" "}
                <span className="text-foreground">over 74%</span>. The yields were real. People
                walked anyway.
              </p>
              <p>
                They walked because every path asks the holder to give something up first — keys to
                a custodian, coins to a bridge multisig, or privacy to a public address. UTXOpia
                removes the trade: bitcoin on Solana, positions private by default, and a withdrawal
                destination registered up front that needs nobody&apos;s approval to reach. That
                part is written into the on-chain program, not into my promises. Explaining it to
                people who will never read a circuit is the job.
              </p>
            </div>

            <p className={`mt-3 text-caption leading-relaxed text-gray ${PROSE}`}>
              Figures checked {DATA_CHECKED}.{" "}
              {SOURCES.map((s, i) => (
                <span key={s.href}>
                  {i > 0 && " · "}
                  <a
                    href={s.href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline underline-offset-4 hover:text-foreground"
                  >
                    {s.label}
                  </a>
                </span>
              ))}
              . Go check them — that&apos;s the whole point.
            </p>

            <p
              className={`mt-5 rounded-[12px] border border-btc/20 bg-btc/[0.05] px-4 py-3 text-caption leading-relaxed text-gray-light ${PROSE}`}
            >
              The claim you&apos;d be defending: on 2026-08-04 we switched our own backend off and a
              member&apos;s bitcoin still left the vault. 46,803 sats, twice — the second run
              rebuilt from chain data alone.
            </p>
          </div>

          <aside className="mt-8 lg:col-start-2 lg:row-start-1 lg:mt-0">
            <div className="lg:sticky lg:top-28">
              <dl className="divide-y divide-gray/10 overflow-hidden rounded-[12px] border border-gray/15 bg-muted/20">
                {FACTS.map(([k, v]) => (
                  <div
                    key={k}
                    className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4 lg:flex-col lg:gap-1"
                  >
                    <dt className="text-caption font-medium text-gray sm:w-32 sm:shrink-0 lg:w-auto lg:text-[10px] lg:uppercase lg:tracking-wider">
                      {k}
                    </dt>
                    <dd className="text-caption leading-relaxed text-foreground">{v}</dd>
                  </div>
                ))}
              </dl>

              <div className="mt-4 flex flex-col gap-3 sm:flex-row lg:flex-col">
                <a
                  href={`mailto:${CONTACT_EMAIL}?subject=Cofounder`}
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-xs font-semibold text-background transition-all hover:bg-white hover:shadow-[0_0_15px_rgba(255,255,255,0.12)]"
                >
                  <Mail className="h-3.5 w-3.5" />
                  Apply
                </a>
                <a
                  href={TELEGRAM_URL}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex flex-1 items-center justify-center gap-2 rounded-full border border-gray/20 px-5 py-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50"
                >
                  <Send className="h-3.5 w-3.5" />
                  Telegram @{TELEGRAM}
                </a>
              </div>

              <a
                href={DECK_PDF_URL}
                download
                className="mt-3 hidden items-center justify-center gap-1.5 text-caption text-gray underline underline-offset-4 transition-colors hover:text-foreground lg:inline-flex"
              >
                <Download className="h-3 w-3" />
                Download the deck as PDF
              </a>
            </div>
          </aside>
        </div>

        {/* ── The deck, inline. Full page width: at 672px every three-column
            slide had to be scrolled through. ── */}
        <h2 id="deck" className="mb-1 mt-14 scroll-mt-28 text-heading6 font-semibold text-foreground">
          The deck
        </h2>
        <p className="mb-4 text-caption text-gray">
          Ten slides — what it is, why bitcoin sits idle, how the vault works, where it is today.
        </p>

        <DeckEmbed />

        <div className="mt-3 flex flex-wrap items-center gap-x-5 gap-y-2 text-caption text-gray">
          <Link
            href="/pitch"
            className="inline-flex items-center gap-1.5 underline underline-offset-4 transition-colors hover:text-foreground"
          >
            <Presentation className="h-3 w-3" />
            Open full screen
          </Link>
          <a
            href={DECK_PDF_URL}
            download
            className="inline-flex items-center gap-1.5 underline underline-offset-4 transition-colors hover:text-foreground"
          >
            <Download className="h-3 w-3" />
            Download as PDF
          </a>
          <span className="text-gray/50">
            Every slide is linkable — <span className="font-mono">/pitch#8</span> is traction.
          </span>
        </div>

        {/* ── Responsibilities ── */}
        <h2 className="mb-4 mt-14 text-heading6 font-semibold text-foreground">
          What you&apos;d own
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {RESPONSIBILITIES.map(([title, body]) => (
            <div key={title} className="rounded-[12px] border border-gray/15 bg-muted/30 px-4 py-3">
              <p className="text-caption font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-caption leading-relaxed text-gray">{body}</p>
            </div>
          ))}
        </div>

        {/* ── Fit. The two lists are read against each other, so on a wide
            screen they belong beside each other. ── */}
        <div className="mt-12 grid gap-10 lg:grid-cols-2 lg:gap-12">
          <div>
            <h2 className="mb-4 text-heading6 font-semibold text-foreground">
              You&apos;re a fit if
            </h2>
            <ul className="space-y-2">
              {FIT.map((line) => (
                <li key={line} className="flex gap-3 text-caption leading-relaxed text-gray-light">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-btc" />
                  {line}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h2 className="mb-4 text-heading6 font-semibold text-foreground">
              You&apos;re not, if
            </h2>
            <ul className="space-y-2">
              {NOT_FIT.map((line) => (
                <li key={line} className="flex gap-3 text-caption leading-relaxed text-gray">
                  <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-gray/40" />
                  {line}
                </li>
              ))}
            </ul>
          </div>
        </div>

        {/* ── The constraint, next to the way in ── */}
        <div className="mt-12 grid items-start gap-10 lg:grid-cols-2 lg:gap-12">
          <div>
            <h2 className="mb-3 text-heading6 font-semibold text-foreground">
              How we talk about this
            </h2>
            <p className="text-body2 leading-relaxed text-gray-light">
              No points, no airdrops, no paid influencers. Every claim maps to something a stranger
              can verify, with its source and the date we checked it — that&apos;s the standard for
              anything you&apos;d publish. We say less than our competitors on purpose.
            </p>
            <p className="mt-3 text-body2 leading-relaxed text-gray-light">
              You don&apos;t need to understand the cryptography — I do that part. You do need to
              defend it to a hostile reader, and making sure you can is my job.
            </p>
          </div>

          <div className="rounded-[20px] border border-gray/20 bg-card/60 p-5 sm:p-6">
            <h2 className="text-heading6 font-semibold text-foreground">How to apply</h2>
            <p className="mt-2 text-caption leading-relaxed text-gray-light">
              Email or Telegram. No CV — send three things:
            </p>
            <ol className="mt-3 space-y-2">
              {APPLY.map((line, i) => (
                <li key={line} className="flex gap-3 text-caption leading-relaxed text-gray-light">
                  <span className="font-mono text-btc">{i + 1}</span>
                  {line}
                </li>
              ))}
            </ol>
            <p className="mt-4 text-caption leading-relaxed text-gray">
              Write, and I&apos;ll show you everything: the code, the numbers, and the parts that
              are broken.
            </p>
            <div className="mt-5 flex flex-col gap-3 sm:flex-row">
              <a
                href={`mailto:${CONTACT_EMAIL}?subject=Cofounder`}
                className="inline-flex items-center justify-center gap-2 rounded-full bg-foreground px-5 py-3 text-xs font-semibold text-background transition-all hover:bg-white hover:shadow-[0_0_15px_rgba(255,255,255,0.12)]"
              >
                <Mail className="h-3.5 w-3.5" />
                {CONTACT_EMAIL}
              </a>
              <a
                href={TELEGRAM_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center justify-center gap-2 rounded-full border border-gray/20 px-5 py-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50"
              >
                <Send className="h-3.5 w-3.5" />@{TELEGRAM}
              </a>
            </div>
          </div>
        </div>

        <p className="mt-10 text-caption text-gray">
          Live today on devnet — public alpha, testnet only, unaudited. The code is{" "}
          <a
            href="https://github.com/UTXOpia"
            target="_blank"
            rel="noopener noreferrer"
            className="underline underline-offset-4 hover:text-foreground"
          >
            open
          </a>
          , and so are the{" "}
          <Link
            href={hrefWithChain("/docs", networkId)}
            className="underline underline-offset-4 hover:text-foreground"
          >
            docs
          </Link>
          .
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
