import { CONTACT_EMAIL, DATA_CHECKED, TELEGRAM, TELEGRAM_URL } from "@/lib/contact";

/**
 * The deck, as data. This file is the source of truth for the pitch — /pitch and
 * the /careers embed render it, and `bun run deck` exports it to PPTX. Edit the
 * deck here, never in Google Slides; a slide deck that lives in a drive folder
 * drifts from the product the first time either one changes.
 *
 * Plain data on purpose: no JSX, so the export script can import it under bun
 * without a React runtime. Layout lives in slides.tsx (web) and
 * scripts/export-deck.ts (pptx), and both must handle every block kind below.
 */

/** Gold is bitcoin, purple is privacy. Anything else is decoration. */
export type Accent = "btc" | "privacy";

/** Icon names resolve to lucide on the web; the exporter draws a plain chip. */
export type IconName =
  | "key"
  | "users"
  | "eye"
  | "eye-off"
  | "fingerprint"
  | "lock"
  | "shield-check"
  | "settings"
  | "zap"
  | "landmark"
  | "globe"
  | "user-check"
  | "bitcoin"
  | "trending-up"
  | "shield";

export type Card = {
  icon?: IconName;
  title: string;
  body: string;
  /** Second paragraph, in the accent colour — the line that closes the card. */
  note?: string;
  accent?: Accent;
};

export type Block =
  | { kind: "pills"; items: string[] }
  | { kind: "cards"; cols: 1 | 2 | 3; items: Card[] }
  | { kind: "flow"; items: { title: string; body: string; accent?: Accent }[] }
  | { kind: "numbered"; items: { title: string; body: string }[] }
  | { kind: "callout"; label?: string; body: string; accent?: Accent; boxed?: boolean }
  | { kind: "links"; items: { label: string; href: string }[] };

export type Slide = {
  n: number;
  /** Short name for the slide rail and the aria labels. */
  label: string;
  kicker: string;
  title: string;
  lead?: string;
  blocks?: Block[];
  /** The one-line argument the slide leaves behind. */
  footnote?: string;
};

export const SLIDES: Slide[] = [
  {
    n: 1,
    label: "Title",
    kicker: "UTXOpia",
    title: "Put idle bitcoin to work without giving it up.",
    lead: "Shield bitcoin into a private vault on Solana. Hold it privately, move it privately, deploy it anywhere and withdraw on your own, even if we're gone.",
    blocks: [{ kind: "pills", items: ["Private", "Non-custodial", "Programmable"] }],
  },
  {
    n: 2,
    label: "Problem",
    kicker: "Problem",
    title: "Most bitcoin sits idle",
    lead: "Every path to making bitcoin productive asks the holder to give something up first.",
    blocks: [
      {
        kind: "cards",
        cols: 3,
        items: [
          {
            icon: "landmark",
            title: "Give up your keys",
            body: "Custodians and CeFi lenders take custody first. The history of that trade is a list of names that no longer exist.",
          },
          {
            icon: "users",
            title: "Give up to a multisig",
            body: "Wrapped BTC rests on a bridge multisig — an m-of-n club of signers you must simply hope stays honest.",
          },
          {
            icon: "eye",
            title: "Give up your privacy",
            body: "Public addresses publish every position: your size, your timing, your counterparties — linked and traceable forever.",
          },
        ],
      },
    ],
    footnote: "So the largest pool of capital in crypto mostly does nothing.",
  },
  {
    n: 3,
    label: "Solution",
    kicker: "Solution",
    title: "The on-ramp that asks for neither",
    blocks: [
      {
        kind: "flow",
        items: [
          { title: "Bitcoin", body: "Native BTC, your keys" },
          { title: "SPV proof", body: "Chain proof — no trusted bridge" },
          { title: "Shielded vault", body: "Private note on Solana, Ika-secured", accent: "btc" },
          { title: "SPL token", body: "Deploy anywhere on Solana" },
        ],
      },
      {
        kind: "callout",
        body: "And back: exit to native bitcoin on your own — your proof, your registered destination, no UTXOpia servers required.",
      },
      {
        kind: "cards",
        cols: 1,
        items: [
          {
            title: "Inside the vault, bitcoin is a private note",
            body: "Holdings and transfers are cryptographic commitments — amounts, senders, and recipients stay hidden while your capital stays deployable.",
          },
        ],
      },
    ],
    footnote: "Bitcoin-native capital, live on a high-performance chain — still yours, still private.",
  },
  {
    n: 4,
    label: "Self-custodial",
    kicker: "Pillar 1 — Self-custodial",
    title: "Securing the vault",
    blocks: [
      {
        kind: "cards",
        cols: 3,
        items: [
          {
            icon: "key",
            title: "Ika 2PC-MPC dWallet",
            body: "The vault's BTC is held by a dWallet on the Ika threshold network. Every signature requires two shares — the user's and the network's. Neither side can ever sign alone: the user is one of the signers, in the math itself.",
          },
          {
            icon: "shield-check",
            title: "No bridge multisig",
            body: "Bitcoin enters by SPV proof — no m-of-n club of signers to trust or compromise. The security assumption is removed, not shrunk.",
          },
          {
            icon: "lock",
            title: "Exits no one can block",
            body: "Every exit is authorised by the user's own proof plus a destination registered at admission. Redeem ignores auditor_frozen (redeem.rs:275), and a registered exit destination can never be removed.",
          },
        ],
      },
    ],
    footnote: "Custody never leaves the user — even our own freeze flag cannot trap funds.",
  },
  {
    n: 5,
    label: "Private",
    kicker: "Pillar 2 — Private",
    title: "Private while it's yours",
    blocks: [
      {
        kind: "cards",
        cols: 3,
        items: [
          {
            icon: "shield-check",
            accent: "privacy",
            title: "Groth16 JoinSplit proofs",
            body: "Every transfer inside the vault is a zero-knowledge proof: nullifiers in, commitments out. The chain verifies correctness without learning anything else.",
          },
          {
            icon: "eye-off",
            accent: "privacy",
            title: "Nothing to link",
            body: "No amounts, no sender, no recipient on chain. Your BTC size, your entry timing, and your internal moves stay yours — a needle with no haystack coordinates.",
          },
          {
            icon: "fingerprint",
            accent: "privacy",
            title: "Stealth by default",
            body: "Stealth addresses give recipient privacy on every payment. Privacy is the default state of the vault, not an opt-in feature.",
          },
        ],
      },
      {
        kind: "callout",
        boxed: true,
        label: "The honest boundary:",
        body: "privacy ends the moment you unshield into a public DeFi position. That's a real line, not a footnote — everything up to that door is protected.",
      },
    ],
  },
  {
    n: 6,
    label: "Programmable",
    kicker: "Pillar 3 — Programmable",
    title: "Policy engine",
    blocks: [
      {
        kind: "cards",
        cols: 2,
        items: [
          {
            icon: "settings",
            title: "A program, not an operator switch",
            body: "Policy lives in a separate on-chain program. Approvals are per-action, single-use, and slot-expiring — no admin can wave a transaction through.",
          },
          {
            icon: "zap",
            title: "Private decisions on MagicBlock",
            body: "Approvals are decided inside an ephemeral rollup — off the public ledger, at millisecond speed — then committed to Solana before any asset instruction can consume one.",
          },
          {
            icon: "landmark",
            title: "Institution-grade controls",
            body: "Per-token caps, timelocked admin updates so no rule changes silently, and allowlisting of BTC sources at the vault door.",
          },
          {
            icon: "eye",
            title: "Selective disclosure",
            body: "A viewing key plus per-transaction proofs show an auditor exactly what the user chooses — with a record of what was shown.",
          },
        ],
      },
    ],
    footnote:
      "Idle BTC is idle because the desk holding it can't get sign-off. This is the layer that answers that.",
  },
  {
    n: 7,
    label: "Two pools",
    kicker: "Two anonymity sets",
    title: "Permissionless & verified pools",
    blocks: [
      {
        kind: "cards",
        cols: 2,
        items: [
          {
            icon: "globe",
            title: "Permissionless pool",
            body: "Open to anyone with bitcoin and an SPV proof. No gatekeeper, no screening — the censorship-resistant heart of the system, and it will always exist.",
            note: "Full shielded privacy: hidden amounts, senders, and recipients.",
          },
          {
            icon: "user-check",
            accent: "privacy",
            title: "Verified pool, audit-ready",
            body: "Same cryptography, different admission rule: deposits and participants pass screening and attestation before entry.",
            note: "Institutions mix only with verified funds — an anonymity set their auditors can reason about and sign off on.",
          },
        ],
      },
    ],
    footnote: "Same proofs, different door — neither pool weakens the other.",
  },
  {
    n: 8,
    label: "Traction",
    kicker: "Traction",
    title: "Milestones that can't be faked",
    blocks: [
      {
        kind: "numbered",
        items: [
          {
            title: "End-to-end flow is live",
            body: "Shield, private transfer, and unshield working today — in product, not on a roadmap.",
          },
          {
            title: "2026-08-04 — backend off, exit still works",
            body: "We switched our own backend off; a member's bitcoin still left the vault. 46,803 sats, twice — second run from scratch.",
          },
          {
            title: "Zero-infrastructure verification",
            body: "The leaf set rebuilds from chain data alone — verifying and exiting needs nothing that runs on our servers.",
          },
          {
            title: "Ika vault + MagicBlock policy engine integrated",
            body: "Trustless BTC custody and private policy approvals are live in the flow you'll see in the demo.",
          },
        ],
      },
    ],
    footnote: "The system already survives its own creators disappearing.",
  },
  {
    n: 9,
    label: "Market",
    kicker: "Market",
    title: "Built for capital that refuses the tradeoff",
    blocks: [
      {
        kind: "cards",
        cols: 2,
        items: [
          {
            icon: "bitcoin",
            title: "Bitcoin holders",
            body: "Long-term capital that wants into DeFi without a public confession of its size — or a custodian holding its keys.",
          },
          {
            icon: "users",
            title: "Crypto-native users",
            body: "Daily on-chain activity without surveillance — private balances and transfers as the default, not the exception.",
          },
          {
            icon: "trending-up",
            title: "Funds & desks",
            body: "Confidential positions with audit-ready disclosure — the sign-off story that finally puts idle treasury BTC to work.",
          },
          {
            icon: "shield",
            title: "Privacy-conscious DeFi",
            body: "Participants who refuse full transparency but still need programmable, verifiable finance.",
          },
        ],
      },
    ],
    footnote: "The idle-bitcoin problem is a trust problem — and trust problems are markets.",
  },
  {
    n: 10,
    label: "Vision",
    kicker: "Vision",
    title: "The private finance layer for bitcoin-native capital across high-performance chains.",
    blocks: [
      {
        kind: "links",
        items: [
          { label: "app.utxopia.com", href: "https://app.utxopia.com" },
          { label: "github.com/UTXOpia", href: "https://github.com/UTXOpia" },
          { label: CONTACT_EMAIL, href: `mailto:${CONTACT_EMAIL}` },
          { label: `@${TELEGRAM}`, href: TELEGRAM_URL },
        ],
      },
    ],
    footnote: "Devnet · public alpha · unaudited. Check every claim before you believe it.",
  },
];

/** Market figures carry their date wherever they appear. */
export const MARKET_SOURCE = `Sources: Spark, BTCFi in 2026 · DefiLlama. Figures checked ${DATA_CHECKED}.`;

export const pad = (n: number) => String(n).padStart(2, "0");
