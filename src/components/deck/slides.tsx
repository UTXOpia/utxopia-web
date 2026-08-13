import React from "react";
import Link from "next/link";
import {
  ArrowUpRight,
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
import { CONTACT_EMAIL, DATA_CHECKED, TELEGRAM, TELEGRAM_URL } from "@/lib/contact";
import { cn } from "@/lib/utils";

/**
 * The deck, once. /pitch renders these one per screen; DeckEmbed renders the
 * same objects as a 16:9 flip-through inside /careers. Nothing here may depend
 * on viewport size — sizing is done with container queries so a slide looks
 * right at 356px wide inside the embed and at 768px full screen.
 */

export type Slide = {
  n: number;
  label: string;
  kicker: string;
  title: string;
  lead?: string;
  footnote?: string;
  body?: React.ReactNode;
};

/**
 * Two accents, each with a job: gold is bitcoin, purple is privacy. Purple
 * appears on exactly one pillar and two lines, which is what stops it reading
 * as decoration.
 */
const Card = ({
  icon: Icon,
  title,
  body,
  accent = "btc",
}: {
  icon?: React.ElementType;
  title: string;
  body: string;
  accent?: "btc" | "privacy";
}) => (
  <div className="rounded-[14px] border border-gray/15 bg-muted/30 p-3 @xl:p-4">
    {Icon && (
      <Icon
        className={`mb-2 h-4 w-4 @xl:mb-3 ${accent === "privacy" ? "text-privacy/80" : "text-btc/80"}`}
      />
    )}
    <p className="text-caption font-semibold text-foreground">{title}</p>
    <p className="mt-1.5 text-caption leading-relaxed text-gray">{body}</p>
  </div>
);

// Breakpoints are sized for the narrowest place a slide renders — inside the
// embed the container is ~582px at 1440, so both column counts land at @lg
// (512px) rather than sitting a few pixels under a higher breakpoint.
const Grid = ({ cols, children }: { cols: 2 | 3; children: React.ReactNode }) => (
  <div className={`grid gap-2.5 @xl:gap-3 ${cols === 3 ? "@lg:grid-cols-3" : "@lg:grid-cols-2"}`}>
    {children}
  </div>
);

export const SLIDES: Slide[] = [
  {
    n: 1,
    label: "Title",
    kicker: "UTXOpia",
    title: "Put idle bitcoin to work without giving it up",
    lead: "Shield bitcoin into a private vault on Solana. Hold it privately, move it privately, deploy it anywhere — and withdraw on your own, even if we're gone.",
    body: (
      <div className="flex flex-wrap gap-2">
        {["Private", "Non-custodial", "Programmable"].map((t) => (
          <span
            key={t}
            className="rounded-full border border-btc/25 bg-btc/[0.07] px-3.5 py-1.5 text-caption text-btc"
          >
            {t}
          </span>
        ))}
      </div>
    ),
  },
  {
    n: 2,
    label: "Problem",
    kicker: "Problem",
    title: "Most bitcoin sits idle",
    lead: "Every path to making bitcoin productive asks the holder to give something up first.",
    footnote: "So the largest pool of capital in crypto mostly does nothing.",
    body: (
      <Grid cols={3}>
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
      </Grid>
    ),
  },
  {
    n: 3,
    label: "Solution",
    kicker: "Solution",
    title: "The on-ramp that asks for neither",
    lead: "Inside the vault, bitcoin is a private note. Holdings and transfers are cryptographic commitments — amounts, senders and recipients stay hidden while your capital stays deployable.",
    footnote:
      "And back: exit to native bitcoin on your own — your proof, your registered destination, no UTXOpia servers required.",
    body: (
      // Boxes are direct flex siblings so all four share the row equally; an
      // arrow nested inside the last wrapper would make that box wider.
      <div className="flex flex-col gap-2 @xl:flex-row @xl:items-stretch">
        {[
          ["Bitcoin", "Native BTC, your keys"],
          ["SPV proof", "Chain proof — no trusted bridge"],
          ["Shielded vault", "Private note on Solana, Ika-secured"],
          ["SPL token", "Deploy anywhere on Solana"],
        ].map(([step, sub], i, arr) => (
          <React.Fragment key={step}>
            <div className="flex-1 rounded-[12px] border border-gray/15 bg-muted/30 px-3 py-2.5">
              <p className="text-caption font-semibold text-foreground">{step}</p>
              <p className="mt-0.5 text-[10px] leading-snug text-gray">{sub}</p>
            </div>
            {i < arr.length - 1 && (
              <span className="self-center text-caption text-gray/40">
                <span className="@xl:hidden">↓</span>
                <span className="hidden @xl:inline">→</span>
              </span>
            )}
          </React.Fragment>
        ))}
      </div>
    ),
  },
  {
    n: 4,
    label: "Self-custodial",
    kicker: "Pillar 1 — Self-custodial",
    title: "Securing the vault",
    footnote: "Custody never leaves the user — even our own freeze flag cannot trap funds.",
    body: (
      <Grid cols={3}>
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
      </Grid>
    ),
  },
  {
    n: 5,
    label: "Private",
    kicker: "Pillar 2 — Private",
    title: "Private while it's yours",
    footnote:
      "The honest boundary: privacy ends the moment you unshield into a public DeFi position. That's a real line, not a footnote — everything up to that door is protected.",
    body: (
      <Grid cols={3}>
        <Card
          icon={ShieldCheck}
          accent="privacy"
          title="Groth16 JoinSplit proofs"
          body="Every transfer inside the vault is a zero-knowledge proof: nullifiers in, commitments out. The chain verifies correctness without learning anything else."
        />
        <Card
          icon={EyeOff}
          accent="privacy"
          title="Nothing to link"
          body="No amounts, no sender, no recipient on chain. Your size, your entry timing and your internal moves stay yours."
        />
        <Card
          icon={Fingerprint}
          accent="privacy"
          title="Stealth by default"
          body="Stealth addresses give recipient privacy on every payment. Privacy is the default state of the vault, not an opt-in feature."
        />
      </Grid>
    ),
  },
  {
    n: 6,
    label: "Programmable",
    kicker: "Pillar 3 — Programmable",
    title: "Policy engine",
    footnote:
      "Idle BTC is idle because the desk holding it can't get sign-off. This is the layer that answers that.",
    body: (
      <Grid cols={2}>
        <Card
          title="A program, not an operator switch"
          body="Policy lives in a separate on-chain program. Approvals are per-action, single-use and slot-expiring — no admin can wave a transaction through."
        />
        <Card
          title="Private decisions on MagicBlock"
          body="Approvals are decided inside an ephemeral rollup — off the public ledger, at millisecond speed — then committed to Solana before any asset instruction can consume one."
        />
        <Card
          title="Institution-grade controls"
          body="Per-token caps, timelocked admin updates so no rule changes silently, and allowlisting of BTC sources at the vault door."
        />
        <Card
          title="Selective disclosure"
          body="A viewing key plus per-transaction proofs show an auditor exactly what the user chooses — with a record of what was shown."
        />
      </Grid>
    ),
  },
  {
    n: 7,
    label: "Two pools",
    kicker: "Two anonymity sets",
    title: "Permissionless & verified pools",
    footnote: "Same proofs, different door — neither pool weakens the other.",
    body: (
      <div className="grid gap-2.5 @lg:grid-cols-2 @xl:gap-3">
        <div className="rounded-[14px] border border-gray/15 bg-muted/30 p-3 @xl:p-4">
          <p className="text-caption font-semibold text-foreground">Permissionless pool</p>
          <p className="mt-1.5 text-caption leading-relaxed text-gray">
            Open to anyone with bitcoin and an SPV proof. No gatekeeper, no screening — the
            censorship-resistant heart of the system, and it will always exist.
          </p>
          <p className="mt-3 text-caption text-privacy">
            Full shielded privacy: hidden amounts, senders and recipients.
          </p>
        </div>
        <div className="rounded-[14px] border border-privacy/20 bg-privacy/[0.05] p-3 @xl:p-4">
          <p className="text-caption font-semibold text-foreground">Verified pool, audit-ready</p>
          <p className="mt-1.5 text-caption leading-relaxed text-gray">
            Same cryptography, different admission rule: deposits and participants pass screening
            and attestation before entry.
          </p>
          <p className="mt-3 text-caption text-privacy">
            Institutions mix only with verified funds — an anonymity set their auditors can reason
            about and sign off on.
          </p>
        </div>
      </div>
    ),
  },
  {
    n: 8,
    label: "Traction",
    kicker: "Traction",
    title: "Milestones that can't be faked",
    footnote: "The system already survives its own creators disappearing.",
    body: (
      <div className="space-y-2 @xl:space-y-2.5">
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
            className="flex gap-3 rounded-[14px] border border-gray/15 bg-muted/30 p-3 @xl:gap-4 @xl:p-4"
          >
            <span className="font-mono text-caption text-btc/70">{i + 1}</span>
            <div>
              <p className="text-caption font-semibold text-foreground">{title}</p>
              <p className="mt-1 text-caption leading-relaxed text-gray">{body}</p>
            </div>
          </div>
        ))}
      </div>
    ),
  },
  {
    n: 9,
    label: "Market",
    kicker: "Market",
    title: "Built for capital that refuses the tradeoff",
    lead: "91,332 BTC — 0.46% of circulating supply — is deployed in bitcoin DeFi. Ethereum DeFi uses roughly 15% of circulating ETH. BTCFi TVL peaked near $9.1B in October 2025; by Q1 2026 L2 and sidechain TVL had contracted over 74%. The yields were real. People walked anyway.",
    footnote: `Sources: Spark, BTCFi in 2026 · DefiLlama. Figures checked ${DATA_CHECKED}. The idle-bitcoin problem is a trust problem — and trust problems are markets.`,
    body: (
      <Grid cols={2}>
        <Card
          title="Bitcoin holders"
          body="Long-term capital that wants into DeFi without a public confession of its size — or a custodian holding its keys."
        />
        <Card
          title="Crypto-native users"
          body="Daily on-chain activity without surveillance — private balances and transfers as the default, not the exception."
        />
        <Card
          title="Funds & desks"
          body="Confidential positions with audit-ready disclosure — the sign-off story that finally puts idle treasury BTC to work."
        />
        <Card
          title="Privacy-conscious DeFi"
          body="Participants who refuse full transparency but still need programmable, verifiable finance."
        />
      </Grid>
    ),
  },
  {
    n: 10,
    label: "Ask",
    kicker: "Vision",
    title: "The private finance layer for bitcoin-native capital across high-performance chains.",
    footnote: "Devnet · public alpha · unaudited. Check every claim before you believe it.",
    body: (
      <div>
        <div className="flex flex-wrap gap-2.5">
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className="inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-xs font-semibold text-background transition-all hover:bg-white"
          >
            <Mail className="h-3.5 w-3.5" />
            {CONTACT_EMAIL}
          </a>
          <a
            href={TELEGRAM_URL}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-2 rounded-full border border-gray/20 px-4 py-2.5 text-xs font-semibold text-foreground transition-colors hover:bg-muted/50"
          >
            <Send className="h-3.5 w-3.5" />@{TELEGRAM}
          </a>
        </div>
        <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-caption text-gray">
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
          <Link href="/careers" className="underline underline-offset-4 hover:text-foreground">
            We&apos;re looking for a cofounder
          </Link>
        </div>
      </div>
    ),
  },
];

export const pad = (n: number) => String(n).padStart(2, "0");

/**
 * One slide's content. The caller owns the box; this owns everything inside it.
 * Every size below is a container query, so the same markup reads correctly in
 * a 356px embed and on a 1440px screen.
 *
 * `className` is how a caller widens the slide — the cards want the room, so
 * the ceiling belongs to whoever knows how much room there is. Running text
 * keeps its own measure regardless, in `ch`, so a wider slide grows the grids
 * and not the line length.
 */
export function SlideBody({ slide, className }: { slide: Slide; className?: string }) {
  return (
    <div className={cn("@container mx-auto w-full max-w-3xl", className)}>
      <div className="mb-3 flex items-center gap-3 @xl:mb-5">
        <span className="font-mono text-[10px] text-btc/70">{pad(slide.n)}</span>
        <span className="h-px w-6 bg-btc/30" />
        <span className="text-[10px] font-medium uppercase tracking-[0.2em] text-gray">
          {slide.kicker}
        </span>
      </div>

      <h2 className="max-w-[24ch] text-lg font-semibold leading-tight tracking-tight text-foreground @lg:text-2xl @3xl:text-4xl">
        {slide.title}
      </h2>

      {slide.lead && (
        <p className="mt-3 max-w-[68ch] text-caption leading-relaxed text-gray-light @xl:mt-4 @xl:text-body2">
          {slide.lead}
        </p>
      )}

      {slide.body && <div className="mt-5 @xl:mt-8">{slide.body}</div>}

      {slide.footnote && (
        <p className="mt-5 max-w-[70ch] text-caption leading-relaxed text-gray @xl:mt-8">
          {slide.footnote}
        </p>
      )}
    </div>
  );
}
