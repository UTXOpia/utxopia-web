"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  ArrowUpRight,
  ChevronDown,
  Eye,
  EyeOff,
  Fingerprint,
  Key,
  Lock,
  Mail,
  Send,
  ShieldCheck,
  Users,
} from "lucide-react";

/**
 * The deck as a web page: one screen per slide, scroll-snapped, addressable at
 * /pitch#1 … #10 so any single slide can be linked into a conversation.
 *
 * Deliberately chrome-free — no site header or footer. It is a deck, and the
 * only navigation that matters is next/previous.
 */

const CONTACT_EMAIL = "albert@utxopia.com";
const TELEGRAM = "amidoggy";
const DATA_CHECKED = "13 August 2026";

const LABELS = [
  "Title",
  "Problem",
  "Solution",
  "Self-custodial",
  "Private",
  "Programmable",
  "Two pools",
  "Traction",
  "Market",
  "Ask",
];

const pad = (n: number) => String(n).padStart(2, "0");

function Slide({
  n,
  kicker,
  title,
  lead,
  children,
  footnote,
}: {
  n: number;
  kicker: string;
  title: string;
  lead?: string;
  children?: React.ReactNode;
  footnote?: string;
}) {
  return (
    <section
      id={String(n)}
      data-slide={n}
      className="relative flex h-dvh snap-start flex-col justify-center px-6 py-20 sm:px-16 lg:px-24"
    >
      <div className="mx-auto w-full max-w-3xl">
        <div className="mb-5 flex items-center gap-3">
          <span className="font-mono text-[10px] text-privacy/70">{pad(n)}</span>
          <span className="h-px w-6 bg-privacy/25" />
          <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-gray">
            {kicker}
          </span>
        </div>

        <h2 className="text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          {title}
        </h2>

        {lead && (
          <p className="mt-4 max-w-2xl text-body2 leading-relaxed text-gray-light">{lead}</p>
        )}

        {children && <div className="mt-8">{children}</div>}

        {footnote && <p className="mt-8 text-caption leading-relaxed text-gray">{footnote}</p>}
      </div>
    </section>
  );
}

const Card = ({
  icon: Icon,
  title,
  body,
}: {
  icon: React.ElementType;
  title: string;
  body: string;
}) => (
  <div className="rounded-[14px] border border-gray/15 bg-muted/30 p-4">
    <Icon className="mb-3 h-4 w-4 text-privacy/80" />
    <p className="text-caption font-semibold text-foreground">{title}</p>
    <p className="mt-1.5 text-caption leading-relaxed text-gray">{body}</p>
  </div>
);

export default function PitchPage() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(1);
  const total = LABELS.length;

  const goTo = useCallback((n: number) => {
    const clamped = Math.min(Math.max(n, 1), LABELS.length);
    document.getElementById(String(clamped))?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Track the slide filling the viewport so the counter and rail stay honest.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (hit) setCurrent(Number((hit.target as HTMLElement).dataset.slide));
      },
      { root, threshold: 0.55 },
    );
    root.querySelectorAll("[data-slide]").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const keys = ["ArrowRight", "ArrowDown", "PageDown", "ArrowLeft", "ArrowUp", "PageUp", "Home", "End"];
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      if (e.key === "Home") return goTo(1);
      if (e.key === "End") return goTo(total);
      const back = e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp";
      goTo(current + (back ? -1 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [current, goTo, total]);

  return (
    <div className="relative bg-background">
      {/* Fixed chrome */}
      <Link
        href="/careers"
        className="fixed left-5 top-5 z-30 flex items-center gap-2 rounded-full border border-gray/15 bg-background/70 px-3 py-1.5 backdrop-blur-md transition-colors hover:border-gray/30 sm:left-8 sm:top-8"
      >
        <Image src="/brand/logo-transparent-128.png" alt="" width={16} height={16} />
        <span className="text-[10px] font-semibold tracking-tight text-foreground">UTXOpia</span>
      </Link>

      <div className="fixed bottom-5 left-5 z-30 font-mono text-[10px] text-gray sm:bottom-8 sm:left-8">
        <span className="text-foreground">{pad(current)}</span>
        <span className="text-gray/40"> / {pad(total)}</span>
      </div>

      <nav
        aria-label="Slides"
        className="fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 sm:flex"
      >
        {LABELS.map((label, i) => (
          <button
            key={label}
            onClick={() => goTo(i + 1)}
            aria-label={`Slide ${i + 1}: ${label}`}
            aria-current={current === i + 1}
            className="group flex items-center justify-end gap-2"
          >
            <span
              className={`text-[9px] uppercase tracking-wider transition-opacity ${
                current === i + 1
                  ? "text-gray opacity-100"
                  : "text-gray/60 opacity-0 group-hover:opacity-100"
              }`}
            >
              {label}
            </span>
            <span
              className={`h-1.5 w-1.5 rounded-full transition-all ${
                current === i + 1 ? "scale-125 bg-privacy" : "bg-gray/30 group-hover:bg-gray/60"
              }`}
            />
          </button>
        ))}
      </nav>

      {current < total && (
        <button
          onClick={() => goTo(current + 1)}
          aria-label="Next slide"
          className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full border border-gray/15 bg-background/70 p-2 text-gray backdrop-blur-md transition-colors hover:text-foreground sm:bottom-8"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}

      <div
        ref={scrollerRef}
        className="h-dvh snap-y snap-mandatory overflow-y-scroll scroll-smooth"
      >
        {/* 01 ─────────────────────────────────────── */}
        <section
          id="1"
          data-slide={1}
          className="relative flex h-dvh snap-start flex-col justify-center px-6 sm:px-16 lg:px-24"
        >
          <div className="mx-auto w-full max-w-3xl">
            <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
              UTXOpia
            </h1>
            <p className="mt-4 max-w-xl text-body1 leading-relaxed text-gray-light sm:text-xl">
              Put idle bitcoin to work without giving it up.
            </p>
            <div className="mt-8 flex flex-wrap gap-2">
              {["Private", "Non-custodial", "Programmable"].map((t) => (
                <span
                  key={t}
                  className="rounded-full border border-privacy/20 bg-privacy/[0.06] px-3.5 py-1.5 text-caption text-privacy/90"
                >
                  {t}
                </span>
              ))}
            </div>
            <p className="mt-10 max-w-xl text-caption leading-relaxed text-gray">
              Shield bitcoin into a private vault on Solana. Hold it privately, move it privately,
              deploy it anywhere — and withdraw on your own, even if we&apos;re gone.
            </p>
          </div>
        </section>

        {/* 02 ─────────────────────────────────────── */}
        <Slide
          n={2}
          kicker="Problem"
          title="Most bitcoin sits idle"
          lead="Every path to making bitcoin productive asks the holder to give something up first."
          footnote="So the largest pool of capital in crypto mostly does nothing."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Card
              icon={Key}
              title="Give up your keys"
              body="Custodians and CeFi lenders take custody first. The history of that trade is a list of names that no longer exist."
            />
            <Card
              icon={Users}
              title="Give up to a multisig"
              body="Wrapped BTC rests on a bridge multisig — an m-of-n club of signers you must simply hope stays honest."
            />
            <Card
              icon={Eye}
              title="Give up your privacy"
              body="Public addresses publish every position: your size, your timing, your counterparties — linked and traceable forever."
            />
          </div>
        </Slide>

        {/* 03 ─────────────────────────────────────── */}
        <Slide
          n={3}
          kicker="Solution"
          title="The on-ramp that asks for neither"
          lead="Inside the vault, bitcoin is a private note. Holdings and transfers are cryptographic commitments — amounts, senders and recipients stay hidden while your capital stays deployable."
          footnote="And back: exit to native bitcoin on your own — your proof, your registered destination, no UTXOpia servers required."
        >
          <div className="flex flex-wrap items-stretch gap-2">
            {[
              ["Bitcoin", "Native BTC, your keys"],
              ["SPV proof", "Chain proof — no trusted bridge"],
              ["Shielded vault", "Private note on Solana, Ika-secured"],
              ["SPL token", "Deploy anywhere on Solana"],
            ].map(([step, sub], i, arr) => (
              <div key={step} className="flex items-center gap-2">
                <div className="rounded-[12px] border border-gray/15 bg-muted/30 px-3.5 py-2.5">
                  <p className="text-caption font-semibold text-foreground">{step}</p>
                  <p className="mt-0.5 max-w-[9rem] text-[10px] leading-snug text-gray">{sub}</p>
                </div>
                {i < arr.length - 1 && <span className="text-caption text-gray/40">→</span>}
              </div>
            ))}
          </div>
        </Slide>

        {/* 04 ─────────────────────────────────────── */}
        <Slide
          n={4}
          kicker="Pillar 1 — Self-custodial"
          title="Securing the vault"
          footnote="Custody never leaves the user — even our own freeze flag cannot trap funds."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Card
              icon={Fingerprint}
              title="Ika 2PC-MPC dWallet"
              body="The vault's BTC is held by a dWallet on the Ika threshold network. Every signature needs two shares — the user's and the network's. Neither side can ever sign alone."
            />
            <Card
              icon={ShieldCheck}
              title="No bridge multisig"
              body="Bitcoin enters by SPV proof — no m-of-n club to trust or compromise. The security assumption is removed, not shrunk."
            />
            <Card
              icon={Lock}
              title="Exits no one can block"
              body="Every exit is authorised by the user's own proof plus a destination registered at admission. Redeem ignores auditor_frozen, and a registered destination can never be removed."
            />
          </div>
        </Slide>

        {/* 05 ─────────────────────────────────────── */}
        <Slide
          n={5}
          kicker="Pillar 2 — Private"
          title="Private while it's yours"
          footnote="The honest boundary: privacy ends the moment you unshield into a public DeFi position. That's a real line, not a footnote — everything up to that door is protected."
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Card
              icon={ShieldCheck}
              title="Groth16 JoinSplit proofs"
              body="Every transfer inside the vault is a zero-knowledge proof: nullifiers in, commitments out. The chain verifies correctness without learning anything else."
            />
            <Card
              icon={EyeOff}
              title="Nothing to link"
              body="No amounts, no sender, no recipient on chain. Your size, your entry timing and your internal moves stay yours."
            />
            <Card
              icon={Fingerprint}
              title="Stealth by default"
              body="Stealth addresses give recipient privacy on every payment. Privacy is the default state of the vault, not an opt-in feature."
            />
          </div>
        </Slide>

        {/* 06 ─────────────────────────────────────── */}
        <Slide
          n={6}
          kicker="Pillar 3 — Programmable"
          title="Policy engine"
          footnote="Idle BTC is idle because the desk holding it can't get sign-off. This is the layer that answers that."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [
                "A program, not an operator switch",
                "Policy lives in a separate on-chain program. Approvals are per-action, single-use and slot-expiring — no admin can wave a transaction through.",
              ],
              [
                "Private decisions on MagicBlock",
                "Approvals are decided inside an ephemeral rollup — off the public ledger, at millisecond speed — then committed to Solana before any asset instruction can consume one.",
              ],
              [
                "Institution-grade controls",
                "Per-token caps, timelocked admin updates so no rule changes silently, and allowlisting of BTC sources at the vault door.",
              ],
              [
                "Selective disclosure",
                "A viewing key plus per-transaction proofs show an auditor exactly what the user chooses — with a record of what was shown.",
              ],
            ].map(([title, body]) => (
              <div key={title} className="rounded-[14px] border border-gray/15 bg-muted/30 p-4">
                <p className="text-caption font-semibold text-foreground">{title}</p>
                <p className="mt-1.5 text-caption leading-relaxed text-gray">{body}</p>
              </div>
            ))}
          </div>
        </Slide>

        {/* 07 ─────────────────────────────────────── */}
        <Slide
          n={7}
          kicker="Two anonymity sets"
          title="Permissionless & verified pools"
          footnote="Same proofs, different door — neither pool weakens the other."
        >
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="rounded-[14px] border border-gray/15 bg-muted/30 p-4">
              <p className="text-caption font-semibold text-foreground">Permissionless pool</p>
              <p className="mt-1.5 text-caption leading-relaxed text-gray">
                Open to anyone with bitcoin and an SPV proof. No gatekeeper, no screening — the
                censorship-resistant heart of the system, and it will always exist.
              </p>
              <p className="mt-3 text-caption text-privacy/80">
                Full shielded privacy: hidden amounts, senders and recipients.
              </p>
            </div>
            <div className="rounded-[14px] border border-privacy/20 bg-privacy/[0.05] p-4">
              <p className="text-caption font-semibold text-foreground">Verified pool, audit-ready</p>
              <p className="mt-1.5 text-caption leading-relaxed text-gray">
                Same cryptography, different admission rule: deposits and participants pass
                screening and attestation before entry.
              </p>
              <p className="mt-3 text-caption text-privacy/80">
                Institutions mix only with verified funds — an anonymity set their auditors can
                reason about and sign off on.
              </p>
            </div>
          </div>
        </Slide>

        {/* 08 ─────────────────────────────────────── */}
        <Slide
          n={8}
          kicker="Traction"
          title="Milestones that can't be faked"
          footnote="The system already survives its own creators disappearing."
        >
          <div className="space-y-2.5">
            {[
              [
                "End-to-end flow is live",
                "Shield, private transfer and unshield working today — in product, not on a roadmap.",
              ],
              [
                "2026-08-04 — backend off, exit still works",
                "We switched our own backend off; a member's bitcoin still left the vault. 46,803 sats, twice — second run from scratch.",
              ],
              [
                "Zero-infrastructure verification",
                "The leaf set rebuilds from chain data alone — verifying and exiting needs nothing that runs on our servers.",
              ],
              [
                "Ika vault + MagicBlock policy engine integrated",
                "Trustless BTC custody and private policy approvals are live in the flow you'll see in the demo.",
              ],
            ].map(([title, body], i) => (
              <div
                key={title}
                className="flex gap-4 rounded-[14px] border border-gray/15 bg-muted/30 p-4"
              >
                <span className="font-mono text-caption text-privacy/70">{i + 1}</span>
                <div>
                  <p className="text-caption font-semibold text-foreground">{title}</p>
                  <p className="mt-1 text-caption leading-relaxed text-gray">{body}</p>
                </div>
              </div>
            ))}
          </div>
        </Slide>

        {/* 09 ─────────────────────────────────────── */}
        <Slide
          n={9}
          kicker="Market"
          title="Built for capital that refuses the tradeoff"
          lead="91,332 BTC — 0.46% of circulating supply — is deployed in bitcoin DeFi. Ethereum DeFi uses roughly 15% of circulating ETH. BTCFi TVL peaked near $9.1B in October 2025; by Q1 2026 L2 and sidechain TVL had contracted over 74%. The yields were real. People walked anyway."
          footnote={`Sources: Spark, BTCFi in 2026 · DefiLlama. Figures checked ${DATA_CHECKED}. The idle-bitcoin problem is a trust problem — and trust problems are markets.`}
        >
          <div className="grid gap-3 sm:grid-cols-2">
            {[
              [
                "Bitcoin holders",
                "Long-term capital that wants into DeFi without a public confession of its size — or a custodian holding its keys.",
              ],
              [
                "Crypto-native users",
                "Daily on-chain activity without surveillance — private balances and transfers as the default, not the exception.",
              ],
              [
                "Funds & desks",
                "Confidential positions with audit-ready disclosure — the sign-off story that finally puts idle treasury BTC to work.",
              ],
              [
                "Privacy-conscious DeFi",
                "Participants who refuse full transparency but still need programmable, verifiable finance.",
              ],
            ].map(([title, body]) => (
              <div key={title} className="rounded-[14px] border border-gray/15 bg-muted/30 p-4">
                <p className="text-caption font-semibold text-foreground">{title}</p>
                <p className="mt-1.5 text-caption leading-relaxed text-gray">{body}</p>
              </div>
            ))}
          </div>
        </Slide>

        {/* 10 ─────────────────────────────────────── */}
        <section
          id="10"
          data-slide={10}
          className="relative flex h-dvh snap-start flex-col justify-center px-6 sm:px-16 lg:px-24"
        >
          <div className="mx-auto w-full max-w-3xl">
            <div className="mb-5 flex items-center gap-3">
              <span className="font-mono text-[10px] text-privacy/70">10</span>
              <span className="h-px w-6 bg-privacy/25" />
              <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-gray">
                Vision
              </span>
            </div>
            <h2 className="max-w-2xl text-2xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
              The private finance layer for bitcoin-native capital across high-performance chains.
            </h2>

            <div className="mt-10 flex flex-wrap gap-3">
              <a
                href={`mailto:${CONTACT_EMAIL}`}
                className="inline-flex items-center gap-2 rounded-full bg-foreground px-5 py-3 text-xs font-semibold text-background transition-all hover:bg-white"
              >
                <Mail className="h-3.5 w-3.5" />
                {CONTACT_EMAIL}
              </a>
              <a
                href={`https://t.me/${TELEGRAM}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-2 rounded-full border border-gray/20 px-5 py-3 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50"
              >
                <Send className="h-3.5 w-3.5" />@{TELEGRAM}
              </a>
            </div>

            <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 text-caption text-gray">
              <a
                href="https://app.utxopia.com"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
              >
                app.utxopia.com <ArrowUpRight className="h-3 w-3" />
              </a>
              <a
                href="https://github.com/UTXOpia"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
              >
                github.com/UTXOpia <ArrowUpRight className="h-3 w-3" />
              </a>
              <Link
                href="/careers"
                className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
              >
                We&apos;re looking for a cofounder
              </Link>
            </div>

            <p className="mt-10 text-caption text-gray/60">
              Devnet · public alpha · unaudited. Check every claim before you believe it.
            </p>
          </div>
        </section>
      </div>
    </div>
  );
}
