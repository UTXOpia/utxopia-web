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
 * One open role, posted as directly as the product is described. The page holds
 * itself to the rule it asks the reader to hold us to: every number carries its
 * source and the date it was checked, or it doesn't go on the page.
 */


const FACTS = [
  ["Role", "Cofounder — growth, communications, distribution"],
  ["Compensation", "Equity only. No salary until we raise."],
  ["Equity", "Cofounder-level, discussed as a number in the first call"],
  ["Location", "Remote"],
  ["Stage", "Devnet, public alpha, pre-seed, pre-revenue"],
  ["Team", "One technical founder. You'd be the second."],
] as const;

const RESPONSIBILITIES = [
  {
    title: "Own how this gets explained",
    body: "Turn hard technical results into writing people actually trust. The proofs are done; what they mean to someone who will never read a circuit is not.",
  },
  {
    title: "Turn early users into proof",
    body: "People are already breaking this on devnet. Their runs are the only traction claim we can make honestly — that has to become something a stranger can see.",
  },
  {
    title: "Own distribution",
    body: "Get in front of bitcoin holders, and the desks that hold bitcoin for other people. Idle treasury BTC is idle because somebody can't get sign-off; find those people.",
  },
  {
    title: "Raise beside me",
    body: "You'd be in the room with an equal say — pitching it with me, not building the deck for me.",
  },
];

const FIT = [
  "You can write, and you have something you wrote that changed someone's mind.",
  "You've put a product in front of strangers and got them to use it — not just seen it.",
  "You can hold a conversation with a bitcoin holder or an allocator without bluffing on the tech.",
  "You'd rather say less than a competitor than say something you can't back.",
  "You want ownership and a say, and you can live without a salary while we get there.",
];

const NOT_FIT = [
  "You want a defined scope and someone to approve it.",
  "Your growth playbook starts with points, airdrops or paid influencers.",
  "You need salary certainty right now — that's completely reasonable, it just isn't this.",
];

const APPLY = [
  "Something you wrote that changed someone's mind. Any format.",
  "One thing on this page, or in the deck, that you think is wrong, unclear, or overclaimed.",
  "What you'd do in your first 30 days.",
];

const SOURCES = [
  {
    label: "Spark — BTCFi in 2026",
    href: "https://www.spark.money/research/btcfi-bitcoin-defi-landscape-2026",
  },
  { label: "DefiLlama — chain TVL", href: "https://defillama.com/chains" },
];

export default function CareersPage() {
  const { networkId } = useChainEnvironment();

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto max-w-2xl px-4 pb-20 pt-28 sm:px-6 sm:pt-32">
        {/* ── Posting header ── */}
        <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-gray/15 bg-muted/20 px-3 py-1.5">
          <span className="h-1.5 w-1.5 rounded-full bg-privacy" />
          <span className="text-[10px] font-medium uppercase tracking-wider text-gray">
            one open role
          </span>
        </div>

        <h1 className="mb-3 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
          Cofounder — everything that isn&apos;t code
        </h1>
        <p className="text-body2 leading-relaxed text-gray-light">
          The code works. Everything that isn&apos;t code, doesn&apos;t. That&apos;s the half
          I&apos;m looking for — a cofounder, not a hire. To be direct before you read any
          further: there is no salary, because there is no money yet. What there is, is real
          equity, an equal say, and a raise we walk into together.
        </p>

        <dl className="mt-8 divide-y divide-gray/10 overflow-hidden rounded-[12px] border border-gray/15 bg-muted/20">
          {FACTS.map(([k, v]) => (
            <div key={k} className="flex flex-col gap-0.5 px-4 py-2.5 sm:flex-row sm:gap-4">
              <dt className="text-caption font-medium text-gray sm:w-32 sm:shrink-0">{k}</dt>
              <dd className="text-caption text-foreground">{v}</dd>
            </div>
          ))}
        </dl>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
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

        {/* ── Why the role exists. Every figure sourced and dated. ── */}
        <h2 className="mb-4 mt-14 text-heading6 font-semibold text-foreground">
          Why this role exists
        </h2>

        <div className="space-y-4 text-body2 leading-relaxed text-gray-light">
          <p>
            Bitcoin is the largest pool of capital in crypto and almost none of it does anything.
            About <span className="text-foreground">91,332 BTC — 0.46% of circulating supply</span>{" "}
            is deployed in bitcoin DeFi. Ethereum DeFi uses roughly{" "}
            <span className="text-foreground">15% of circulating ETH</span>. Count generously —
            Babylon staking plus every wrapped variant — and bitcoin still only reaches 0.8%.
          </p>
          <p>
            It isn&apos;t that nobody tried. BTCFi TVL peaked near{" "}
            <span className="text-foreground">$9.1B in October 2025</span>; by Q1 2026 L2 and
            sidechain TVL had contracted <span className="text-foreground">over 74%</span>. Today
            DefiLlama shows roughly <span className="text-foreground">$174M</span> across Stacks,
            Rootstock, BOB, Merlin, Citrea, Core, BSquared and Bitlayer combined. The yields were
            real. People walked anyway.
          </p>
          <p>
            They walked because every path to productive bitcoin asks the holder to give something
            up first: your keys to a custodian, your coins to a bridge multisig, or your privacy to
            a public address that publishes your size, your timing and your counterparties forever.
            If you bought bitcoin specifically so you wouldn&apos;t carry counterparty risk, that is
            an absurd trade — and 99.5% of the supply is declining it.
          </p>
          <p>
            UTXOpia removes the trade. Bitcoin on Solana, positions not published by default, and a
            withdrawal destination registered up front that needs nobody&apos;s approval to reach —
            not a reviewer&apos;s, not mine, not if this company is gone. It&apos;s written into the
            on-chain program, not into my promises.
          </p>
        </div>

        <p className="mt-4 text-caption leading-relaxed text-gray">
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

        <p className="mt-5 rounded-[12px] border border-privacy/15 bg-privacy/[0.04] px-4 py-3 text-caption leading-relaxed text-gray-light">
          The claim you&apos;d be defending: on 2026-08-04 we switched our own backend off and a
          member&apos;s bitcoin still left the vault. 46,803 sats, twice — the second run rebuilt
          from chain data alone. The system already survives its own creators disappearing.
        </p>

        {/* ── The deck, inline ── */}
        <h2 id="deck" className="mb-1 mt-14 scroll-mt-28 text-heading6 font-semibold text-foreground">
          The deck
        </h2>
        <p className="mb-4 text-caption text-gray">
          Ten slides — what it is, why bitcoin sits idle, how the vault works, and where it is
          today.
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
        <div className="space-y-3">
          {RESPONSIBILITIES.map((item) => (
            <div
              key={item.title}
              className="rounded-[12px] border border-gray/15 bg-muted/30 px-4 py-3"
            >
              <p className="text-caption font-semibold text-foreground">{item.title}</p>
              <p className="mt-1 text-caption leading-relaxed text-gray">{item.body}</p>
            </div>
          ))}
        </div>

        {/* ── Fit ── */}
        <h2 className="mb-4 mt-12 text-heading6 font-semibold text-foreground">
          You&apos;re a fit if
        </h2>
        <ul className="space-y-2">
          {FIT.map((line) => (
            <li key={line} className="flex gap-3 text-caption leading-relaxed text-gray-light">
              <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-privacy" />
              {line}
            </li>
          ))}
        </ul>

        <h2 className="mb-4 mt-10 text-heading6 font-semibold text-foreground">
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

        {/* ── The constraint ── */}
        <h2 className="mb-3 mt-12 text-heading6 font-semibold text-foreground">
          How we talk about this
        </h2>
        <p className="text-body2 leading-relaxed text-gray-light">
          No points, no airdrops, no paid influencers, no engagement farming. Not now, not later.
          Every claim has to map to something a stranger can verify — every number on this page
          carries its source and the date we checked it, and that is the standard for everything you
          would publish. We say less than our competitors on purpose. If that reads as the
          constraint you&apos;ve been waiting for rather than the one that annoys you, we&apos;ll
          get on.
        </p>
        <p className="mt-4 text-body2 leading-relaxed text-gray-light">
          You don&apos;t need to understand the cryptography — I do that part. You do need to be
          able to defend it to a hostile reader, and making sure you can is my job.
        </p>

        {/* ── How to apply ── */}
        <div className="mt-12 rounded-[20px] border border-gray/20 bg-card/60 p-5 sm:p-6">
          <h2 className="text-heading6 font-semibold text-foreground">How to apply</h2>
          <p className="mt-2 text-caption leading-relaxed text-gray-light">
            Email or Telegram, whichever you prefer. No CV needed — send three things:
          </p>
          <ol className="mt-3 space-y-2">
            {APPLY.map((line, i) => (
              <li key={line} className="flex gap-3 text-caption leading-relaxed text-gray-light">
                <span className="font-mono text-privacy/70">{i + 1}</span>
                {line}
              </li>
            ))}
          </ol>
          <p className="mt-4 text-caption leading-relaxed text-gray">
            If you&apos;re already building something, don&apos;t leave it. If you&apos;ve been
            waiting for something worth leaving for — write, and I&apos;ll show you everything: the
            code, the numbers, and the parts that are broken.
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

        <p className="mt-6 text-caption text-gray">
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
          . Check the claims before you write.
        </p>
      </div>

      <SiteFooter />
    </main>
  );
}
