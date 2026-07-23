"use client";

/**
 * DocsPage — concise product guide with progressive technical disclosure.
 *
 * Sections:
 * - Start here: four primary user workflows
 * - Expandable reference: features, terms, privacy model, protocol flow
 * - Advanced reference: cryptography, keys, audit, disclosure, and security
 */

import Link from "next/link";
import { useEffect, useMemo } from "react";
import { type LucideIcon } from "lucide-react";
import {
  Shield,
  Lock,
  ArrowRight,
  ShieldCheck,
  TreePine,
  Layers,
  KeyRound,
  Eye,
  Network,
  GitBranch,
  ChevronDown,
  ChevronRight,
  AlertTriangle,
  Send,
  ListChecks,
  ScrollText,
} from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { DocsSection } from "@/components/docs/docs-section";
import { FlowDiagram } from "@/components/docs/flow-diagram";
import {
  DocsSidebar,
  MobileSidebarBar,
  useAllSectionIds,
} from "@/components/docs/docs-sidebar";
import { useActiveSection } from "@/hooks/use-active-section";
import { hrefWithChain } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter } from "@/lib/chain-registry";
import { PRODUCT_COPY, PRODUCT_FEATURES, PRODUCT_TERMS } from "@/lib/product-language";

/* ── Simple card wrapper ── */

function Card({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-xl border border-gray/10 bg-muted/10 p-5 sm:p-6 ${className}`}>
      {children}
    </div>
  );
}

function ExpandableSection({
  id,
  title,
  summary,
  children,
}: {
  id: string;
  title: string;
  summary: string;
  children: React.ReactNode;
}) {
  return (
    <details
      id={id}
      className="group border-t border-gray/10 scroll-mt-24"
    >
      <summary className="flex cursor-pointer list-none items-center justify-between gap-5 py-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-privacy/40 [&::-webkit-details-marker]:hidden">
        <span className="min-w-0">
          <span className="block text-base font-semibold text-foreground sm:text-lg">
            {title}
          </span>
          <span className="mt-1 block max-w-2xl text-xs leading-relaxed text-gray sm:text-sm">
            {summary}
          </span>
        </span>
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-gray/15 text-gray transition-colors group-hover:border-gray/30 group-hover:text-foreground">
          <ChevronDown className="h-4 w-4 transition-transform duration-200 group-open:rotate-180" />
        </span>
      </summary>
      <div className="pb-10 pt-2">
        {children}
      </div>
    </details>
  );
}

/* ── Step card ── */

interface StepCardProps {
  num: string;
  icon: LucideIcon;
  title: string;
  desc: string;
  detail: string;
}

function StepCard({ num, icon: Icon, title, desc, detail }: StepCardProps) {
  return (
    <Card>
      <div className="flex flex-col">
        <div className="flex items-center gap-3 mb-2">
          <span className="text-xs font-mono text-gray/40">{num}</span>
          <div className="p-2 rounded-lg border border-gray/10 bg-background/50">
            <Icon className="w-4 h-4 text-gray-light" />
          </div>
          <h3 className="text-sm sm:text-base font-semibold text-foreground">{title}</h3>
        </div>
        <p className="text-xs sm:text-sm text-gray font-light leading-relaxed mb-3">
          {desc}
        </p>
        <div className="pt-2 border-t border-gray/5">
          <span className="text-[10px] font-mono text-gray/30">{detail}</span>
        </div>
      </div>
    </Card>
  );
}

/* ── Crypto card ── */

function CryptoCard({ title, formula, desc }: { title: string; formula: string; desc: string }) {
  return (
    <Card>
      <h3 className="text-sm sm:text-base font-semibold text-foreground mb-2">{title}</h3>
      <code className="inline-block text-[10px] sm:text-xs font-mono bg-background/50 border border-gray/10 px-2 sm:px-3 py-1.5 rounded-lg text-gray-light mb-3 self-start break-all">
        {formula}
      </code>
      <p className="text-xs sm:text-sm text-gray font-light leading-relaxed">{desc}</p>
    </Card>
  );
}

/* ── Disclosure card ── */

function DisclosureCard({ icon: Icon, title, status, desc, detail }: DisclosureItem) {
  return (
    <Card className="h-full">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div className="flex items-center gap-3">
          <div className="p-2 rounded-lg border border-gray/10 bg-background/50">
            <Icon className="w-4 h-4 text-gray-light" />
          </div>
          <h3 className="text-sm sm:text-base font-semibold text-foreground">{title}</h3>
        </div>
        <span
          className={`shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border text-[10px] font-mono uppercase tracking-wider ${STATUS_STYLE[status]}`}
        >
          {STATUS_LABEL[status]}
        </span>
      </div>
      <p className="text-xs sm:text-sm text-gray font-light leading-relaxed mb-3">{desc}</p>
      <div className="pt-2 border-t border-gray/5">
        <span className="text-[10px] font-mono text-gray/30 break-all">{detail}</span>
      </div>
    </Card>
  );
}

/* ── Security card ── */

function SecurityCard({ icon: Icon, title, desc }: { icon: LucideIcon; title: string; desc: string }) {
  return (
    <Card className="h-full">
      <div className="flex items-center gap-3 mb-2">
        <div className="p-2 rounded-lg border border-gray/10 bg-background/50">
          <Icon className="w-4 h-4 text-gray-light" />
        </div>
        <h3 className="text-sm sm:text-base font-semibold text-foreground">{title}</h3>
      </div>
      <p className="text-xs sm:text-sm text-gray font-light leading-relaxed">{desc}</p>
    </Card>
  );
}

/* ── Key card ── */

function KeyCard({ icon: Icon, title, desc, features }: { icon: LucideIcon; title: string; desc: string; features: string[] }) {
  return (
    <Card className="h-full">
      <div className="flex items-center gap-3 mb-3">
        <div className="p-2 rounded-lg border border-gray/10 bg-background/50">
          <Icon className="w-5 h-5 text-gray-light" />
        </div>
        <h3 className="text-base sm:text-lg font-semibold text-foreground">{title}</h3>
      </div>
      <p className="text-xs sm:text-sm text-gray font-light leading-relaxed mb-4">{desc}</p>
      <div className="space-y-2 mt-auto">
        {features.map((f) => (
          <div key={f} className="flex items-center gap-2 text-[10px] sm:text-[11px] font-mono text-gray/50">
            <span className="w-1.5 h-1.5 rounded-full bg-gray/30 shrink-0" />
            {f}
          </div>
        ))}
      </div>
    </Card>
  );
}

/* ── Comparison table ── */

function getComparisonRows() {
  return [
    { label: "Tokens", traditional: "Single asset (wBTC)", privateBtc: "Multi-token (BTC, SOL, USDC, USDT)" },
    { label: "Balances", traditional: "Visible on-chain", privateBtc: "Hidden as commitments" },
    { label: "Transfers", traditional: "Traceable amounts", privateBtc: "ZK-proven, zero knowledge" },
    { label: "Addresses", traditional: "Linkable & reusable", privateBtc: "One-time stealth addresses" },
    { label: "Deposits", traditional: "Public token minting", privateBtc: "Shielded Merkle insertion" },
    { label: "Withdrawals", traditional: "Traceable burn + send", privateBtc: "Unlinkable via nullifiers" },
    { label: "Custody", traditional: "Multisig / MPC", privateBtc: "Ika dWallet · Solana-controlled" },
  ];
}

function ComparisonTable({ rows }: { rows: ReturnType<typeof getComparisonRows> }) {
  return (
    <Card>
      {/* Desktop header */}
      <div className="hidden sm:grid grid-cols-3 gap-4 pb-3 mb-2 border-b border-gray/10">
        <span className="text-[11px] font-mono uppercase tracking-wider text-gray/40">Aspect</span>
        <span className="text-[11px] font-mono uppercase tracking-wider text-gray/40">Traditional Bridges</span>
        <span className="text-[11px] font-mono uppercase tracking-wider text-gray/50">UTXOpia</span>
      </div>
      {/* Mobile header */}
      <div className="sm:hidden pb-3 mb-2 border-b border-gray/10">
        <span className="text-[11px] font-mono uppercase tracking-wider text-gray/40">Comparison</span>
      </div>
      {rows.map((row) => (
        <div key={row.label}>
          {/* Desktop row */}
          <div className="hidden sm:grid grid-cols-3 gap-4 py-3 border-b border-gray/5 last:border-0">
            <span className="text-sm text-gray-light font-medium">{row.label}</span>
            <span className="text-[12px] text-gray">{row.traditional}</span>
            <span className="text-[12px] text-foreground/70">{row.privateBtc}</span>
          </div>
          {/* Mobile row */}
          <div className="sm:hidden py-3 border-b border-gray/5 last:border-0 space-y-1.5">
            <span className="text-sm text-gray-light font-medium block">{row.label}</span>
            <div className="flex items-start gap-1.5 pl-2">
              <span className="text-[11px] text-gray">Traditional: {row.traditional}</span>
            </div>
            <div className="flex items-start gap-1.5 pl-2">
              <span className="text-[11px] text-foreground/70">Private: {row.privateBtc}</span>
            </div>
          </div>
        </div>
      ))}
    </Card>
  );
}

/* ── Chain-aware data ── */

function getProtocolSteps() {
  const wallet = "Solana wallet";
  const nativeTokens = "SOL/USDC/USDT";
  const program = "Solana program";

  return [
    {
      id: "shield-tokens", num: "01", icon: Shield, title: PRODUCT_COPY.actions.addFunds,
      desc: `Deposit BTC via Taproot, or shield ${nativeTokens} directly from your ${wallet}. Every token enters the same privacy pool — a shared Merkle tree where all commitments look identical regardless of token type or amount.`,
      detail: "BTC: Taproot + SPV · SPL: Shield (disc=12)",
    },
    {
      id: "spv-verification", num: "02", icon: GitBranch, title: "BTC Verification",
      desc: "Bitcoin deposits require a special step: the backend submits an SPV Merkle inclusion proof to the on-chain BTC light client. The Solana program independently validates the Bitcoin transaction was confirmed in a real block — trustless cross-chain verification without any oracle.",
      detail: "On-chain header chain · 6+ confirmations",
    },
    {
      id: "shielded-commitment", num: "03", icon: TreePine, title: "Commitment Creation",
      desc: `Your deposit becomes Poseidon(npk, tokenId, amount) — a cryptographic commitment. The token_id is derived from the SPL mint address: Poseidon(reduce(mint), 0). All tokens share the same depth-16 Merkle tree, making deposits indistinguishable.`,
      detail: "Poseidon hash · Token-agnostic · 65,536 leaves",
    },
    {
      id: "joinsplit-transfer", num: "04", icon: Layers, title: PRODUCT_COPY.transactions.privateTransfer,
      desc: "Every transfer uses a Groth16 zero-knowledge proof that consumes N input notes and produces M output notes. The proof verifies balance conservation, token consistency, nullifier uniqueness, and Merkle membership — all without revealing any values. The same circuit works for supported assets including BTC, SOL, USDC, and USDT.",
      detail: "Groth16 · 256 bytes · Token-agnostic circuit",
    },
    {
      id: "stealth-receive", num: "05", icon: Eye, title: "Stealth Receive",
      desc: "Recipients use one-time stealth addresses generated via the Dual-Key Stealth Address Protocol (EIP-5564) — X25519 ECDH against the recipient's viewing public key. Each deposit or transfer creates a fresh, unlinkable address. The recipient scans announcements with their viewing key to find their notes.",
      detail: "DKSAP · X25519 ECDH · Ed25519 viewing keys",
    },
    {
      id: "unshield-withdraw", num: "06", icon: Network, title: PRODUCT_COPY.actions.takeFundsOut,
      desc: `Take funds out in two ways: cash out supported assets to your ${wallet} (zkSOL returns native SOL), or withdraw zkBTC to a native Bitcoin address through an Ika dWallet controlled by this ${program}. The protocol calls the first operation an unshield. Both operations use a JoinSplit proof, and a nullifier prevents double-spending without revealing the note being spent.`,
      detail: "SPL: instant · BTC: Ika dWallet (Solana-controlled)",
    },
  ];
}

function getCryptoItems() {
  return [
  {
    id: "commitment-scheme", title: "Commitment Scheme",
    formula: "Poseidon(npk, token_id, amount)",
    desc: `Each note is a Poseidon hash of the note public key, token ID, and amount. The token_id = Poseidon(reduce(mint), 0) makes commitments token-specific, so the same circuit can verify each supported asset. Only the owner knows the preimage.`,
  },
  {
    id: "nullifier-generation", title: "Nullifier Generation",
    formula: "Poseidon(nullSecret(spendKey), leafIndex)",
    desc: "When spending a note, the nullifier is derived from a per-wallet null-secret (deterministically derived from your spending key) and the note's Merkle leaf index. You manage the spending key; the null-secret is generated for you. Publishing a nullifier prevents double-spending without revealing which note was consumed.",
  },
  {
    id: "master-public-key", title: "Master Public Key",
    formula: "MPK = Poseidon(spendPub, derivedNullSecret)",
    desc: "The MPK binds the Baby Jubjub spending public key to the wallet's derived null-secret. Per-note public keys come from NPK = Poseidon(MPK, random), giving each note a unique cryptographic identity. Both inputs ultimately trace back to a single spending key — you never manage the null-secret directly.",
  },
  {
    id: "joinsplit-circuit", title: "JoinSplit Circuit",
    formula: "JoinSplit(N, M, depth=16)",
    desc: `A single parameterized circom template handles all transfer types. Inputs: N note nullifiers + Merkle proofs. Outputs: M new commitments. The circuit verifies balance (Σin = Σout), nullifier validity, Merkle membership, and EdDSA-Poseidon signatures — all in one Groth16 proof. Each variant (1×1, 1×2, 2×1, 2×2, …) is a separate Groth16 setup; N + M ≤ 14.`,
  },
  {
    id: "eddsa-signatures", title: "EdDSA-Poseidon Signatures",
    formula: "Sign(spendingKey, message)",
    desc: "Transaction authorization uses EdDSA over the Poseidon hash function on the Baby Jubjub curve. The message includes the Merkle root, bound parameters hash, all nullifiers, and all output commitments — binding the proof to a specific state and preventing a relayer from re-targeting it.",
  },
  {
    id: "stealth-key-agreement", title: "Stealth Key Agreement (DKSAP)",
    formula: "sharedSecret = X25519(ephemeral, viewKey)",
    desc: "Following the Dual-Key Stealth Address Protocol (EIP-5564). Senders generate a random ephemeral keypair and compute a shared secret with the recipient's viewing public key — derived from your viewing key via Ed25519→X25519 conversion. The shared secret derives the one-time note public key. Only the recipient can scan announcements using their viewing private key to detect incoming notes; even repeat payments are unlinkable on-chain.",
  },
  {
    id: "sender-memo", title: "Sender Memo Channel",
    formula: "XChaCha20-Poly1305(ovk, plaintext, AAD = commitment || leafIdx)",
    desc: `An opt-in second event per output, encrypted under the sender's outgoing viewing key (ovk = SHA-256(viewKey ‖ "utxopia.ovk.v1")). Lets the sender (or an auditor holding ovk) later recover their own outgoing history — recipient-only encryption alone wouldn't allow this. AAD binds each memo to its tree leaf: any tamper or re-targeting attempt fails the Poly1305 tag cleanly.`,
  },
  ];
}

type DisclosureStatus = "shipped" | "in-progress" | "planned";

const STATUS_STYLE: Record<DisclosureStatus, string> = {
  shipped: "text-success border-success/30 bg-success/5",
  "in-progress": "text-warning border-warning/30 bg-warning/5",
  planned: "text-gray/60 border-gray/20 bg-gray/5",
};

const STATUS_LABEL: Record<DisclosureStatus, string> = {
  shipped: "Live",
  "in-progress": "Wiring",
  planned: "Planned",
};

interface DisclosureItem {
  id: string;
  icon: LucideIcon;
  title: string;
  status: DisclosureStatus;
  desc: string;
  detail: string;
}

function getDisclosureItems(): DisclosureItem[] {
  return [
    {
      id: "auditor-toolkit",
      icon: ScrollText,
      title: "Auditor Toolkit (DelegatedViewKey)",
      status: "shipped",
      desc: "Issue a slot-scoped, encrypted viewing key for your accountant or auditor. They drop it into the in-browser audit page, decrypt client-side, and walk away with a CSV of IN/OUT records over a chosen range. PBKDF2 + AES-GCM at rest; each issuance is tagged with a delegation ID so you keep a record of who you handed which key to.",
      detail: "scripts/auditor/issue.ts · sdk/src/auditor.ts · /audit",
    },
    {
      id: "sender-memo-channel",
      icon: Send,
      title: "Outgoing Sender Memos",
      status: "shipped",
      desc: "Per-output XChaCha20-Poly1305 envelopes encrypted to the sender's outgoing viewing key. AAD = commitment || leafIndex prevents move-the-memo attacks. Rust transact (disc 13) emits per output when memos are attached; SDK helper buildSenderMemosForTransact composes them client-side; /api/sol/relay forwards them opaquely (viewing keys never leave the client); auditor honors ViewPermissions.INCOMING_ONLY to suppress OUT records when the delegation forbids them.",
      detail: "sdk/src/sender-memo.ts · web/src/app/api/sol/relay/route.ts · sdk/src/auditor.ts",
    },
    {
      id: "selective-disclosure-proofs",
      icon: ListChecks,
      title: "Selective Disclosure Proofs",
      status: "shipped",
      desc: "Prove statements about your shielded holdings without revealing values: ownership-with-threshold (you control commitment X for at least amount Y of token T) and range-sum (sum across N notes ≤ ceiling, with N ∈ {4, 8, 16}). Circuits compiled, prover wired into the SDK, CLIs ship in scripts/auditor/. range-sum N=16 uses a chunked Poseidon attestation since circomlib's hash caps at arity 16.",
      detail: "circuits/build/ownership · scripts/auditor/prove-ownership.ts · scripts/auditor/prove-range-sum.ts",
    },
    {
      id: "compliance-toggle",
      icon: ShieldCheck,
      title: "Per-stealth-address compliance toggle (v2)",
      status: "shipped",
      desc: "Recipients self-publish two pieces on their `.utxopia.sol` SNS subdomain: a `complianceFlags` byte (bit 0 = AUDITOR_DISCLOSABLE) plus an optional 32-byte auditor Solana pubkey. Senders see both in the Send wizard chip: the flag tells them disclosure is OK, the pubkey tells them who specifically. Owners flip the flag and set the pubkey via the Settings page or via `scripts/sns-set-compliance.ts <subdomain> --enable --auditor <base58>`. The reader accepts current version-2 SNS stealth records only.",
      detail: "sdk/src/sns-resolver.ts · scripts/sns-set-compliance.ts · components/settings/preferences-form.tsx",
    },
  ];
}

function getSecurityItems() {
  return [
    {
      icon: ShieldCheck, title: "On-Chain Policy Gate",
      desc: "Signing policy lives in the Solana program itself: amount limits, fee bounds, paused state, and destination whitelist are checked on-chain before the program issues the Ika `approve_message` CPI. A compromised backend cannot drain funds by submitting forged sighashes.",
    },
    {
      icon: Network, title: "Ika dWallet Custody",
      desc: "BTC is held by an Ika dWallet whose authority is a PDA derived from this Solana program (`[\"__ika_cpi_authority\"]`). 2PC-MPC means the Ika network and our program must both participate in every signature — no single key, no off-chain signer committee. Pre-alpha runs a single mock signer; real distributed MPC ships at Ika mainnet.",
    },
    {
      icon: GitBranch, title: "Trustless Verification",
      desc: "Bitcoin deposits are verified on-chain via SPV proofs against a light client tracking BTC block headers. The Solana program validates Merkle inclusion directly — no oracle or trusted third party.",
    },
    {
      icon: Lock, title: "Double-Spend Prevention",
      desc: "Each note can only be spent once. Publishing a nullifier (derived from spending key + leaf index) marks the note as consumed. The on-chain program rejects duplicate nullifiers permanently.",
    },
    {
      icon: AlertTriangle, title: "Auditable CPI Trail",
      desc: "Every redemption emits an `approve_message` CPI on-chain, with the sighash, dWallet ID, and signature scheme recorded as inner instructions in the Solana transaction. The full signing history is reconstructable from RPC alone — no separate audit log to operate.",
    },
  ];
}

/* ── Page ── */

export default function DocsPage() {
  const { networkId: network, config } = useChainEnvironment();
  const chainName = getChainAdapter(config).displayName;
  const sectionIds = useAllSectionIds();
  const activeSection = useActiveSection(sectionIds);

  const comparisonRows = useMemo(() => getComparisonRows(), []);
  const protocolSteps = useMemo(() => getProtocolSteps(), []);
  const cryptoItems = useMemo(() => getCryptoItems(), []);
  const disclosureItems = useMemo(() => getDisclosureItems(), []);
  const securityItems = useMemo(() => getSecurityItems(), []);

  const tokenList = "BTC, SOL, USDC, and USDT";

  useEffect(() => {
    const id = window.location.hash.slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    const disclosure =
      target instanceof HTMLDetailsElement ? target : target?.closest("details");
    if (disclosure) disclosure.open = true;
  }, []);

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />

      <MobileSidebarBar activeSection={activeSection} />

      <div className="relative z-10 flex">
        {/* Desktop sidebar — spans full height (border runs top→bottom); only
            the nav content is padded down so it clears the floating header. */}
        <aside className="hidden lg:block w-[240px] xl:w-[268px] shrink-0">
          <div className="sticky top-0 h-screen overflow-y-auto border-r border-gray/10 px-4 pb-10 pt-8">
            <div className="mb-6 flex items-center gap-2">
              <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-gray/40">
                Product Guide
              </span>
              <span className="text-[10px] font-mono uppercase tracking-wider text-chain/70">
                {chainName}
              </span>
            </div>
            <DocsSidebar activeSection={activeSection} />
          </div>
        </aside>

        {/* Content area */}
        <div className="flex-1 min-w-0">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 xl:px-12">

            <section className="pb-8 pt-24 sm:pb-10 sm:pt-28 lg:pt-32">
              <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
                UTXOpia Guide
              </h1>
              <p className="mt-3 max-w-xl text-sm leading-relaxed text-gray sm:text-base">
                Choose a task below. Open the reference topics only when you need more detail.
              </p>
            </section>

            <DocsSection id="using-utxopia" className="pb-12">
              <h2 className="mb-2 text-lg font-semibold text-foreground">Start here</h2>
              <p className="mb-5 max-w-2xl text-sm leading-relaxed text-gray">
                Your private vault is separate from your connected Bitcoin or Solana wallet.
              </p>
              <div className="divide-y divide-gray/10 rounded-xl border border-gray/10">
                {[
                  ["/vault/deposit", PRODUCT_COPY.actions.addFunds, "Deposit BTC or shield a supported Solana asset."],
                  ["/send", PRODUCT_COPY.actions.sendPrivately, "Pay a UTXOpia name, private receive address, or claim link."],
                  ["/vault/withdraw", PRODUCT_COPY.actions.takeFundsOut, "Cash out to Solana or withdraw zkBTC to Bitcoin."],
                  ["/vault/activity", PRODUCT_COPY.actions.reviewActivity, "See BTC deposits, shields, private transfers, cash outs, and BTC withdrawals."],
                ].map(([route, title, description]) => (
                  <Link
                    key={route}
                    href={hrefWithChain(route, network)}
                    className="group flex items-center justify-between gap-4 px-4 py-4 transition-colors hover:bg-muted/20 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-privacy/40"
                  >
                    <span>
                      <span className="block text-sm font-medium text-foreground group-hover:text-privacy">
                        {title}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-gray">
                        {description}
                      </span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray/50 transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
                  </Link>
                ))}
              </div>
            </DocsSection>

            <ExpandableSection
              id="feature-reference"
              title="All features"
              summary="A complete route-by-route map of the app."
            >
              <div className="divide-y divide-gray/10 rounded-xl border border-gray/10">
                {PRODUCT_FEATURES.map((feature) => (
                  <Link
                    key={feature.route}
                    href={hrefWithChain(feature.route, network)}
                    className="group flex flex-col gap-1 p-4 transition-colors hover:bg-muted/20 sm:flex-row sm:items-start sm:justify-between sm:gap-6"
                  >
                    <span className="min-w-0">
                      <span className="text-sm font-medium text-foreground group-hover:text-privacy">
                        {feature.name}
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-gray">
                        {feature.purpose}
                      </span>
                    </span>
                    <code className="shrink-0 text-[11px] text-gray/40">{feature.route}</code>
                  </Link>
                ))}
              </div>
            </ExpandableSection>

            <ExpandableSection
              id="terminology"
              title="Key terms"
              summary="Plain-language definitions for the names used in the app."
            >
              <dl className="divide-y divide-gray/10">
                {PRODUCT_TERMS.map((item) => (
                  <div key={item.term} className="py-4 sm:grid sm:grid-cols-[160px_1fr] sm:gap-6">
                    <dt className="text-sm font-medium text-foreground">{item.term}</dt>
                    <dd className="mt-1 text-sm leading-relaxed text-gray sm:mt-0">{item.meaning}</dd>
                  </div>
                ))}
              </dl>
            </ExpandableSection>

            <ExpandableSection
              id="overview"
              title="Privacy model"
              summary={`What UTXOpia hides and what remains public for ${tokenList}.`}
            >
              <ComparisonTable rows={comparisonRows} />
            </ExpandableSection>

            <ExpandableSection
              id="protocol-flow"
              title="How it works"
              summary="The path from deposit to private note, transfer, and exit."
            >
              <FlowDiagram />
              <div className="mt-8 space-y-4">
                {protocolSteps.map((step) => (
                  <DocsSection key={step.id} id={step.id}>
                    <StepCard {...step} />
                  </DocsSection>
                ))}
              </div>
            </ExpandableSection>

            <ExpandableSection
              id="cryptography"
              title="Cryptography and keys"
              summary="Commitments, nullifiers, proofs, stealth addresses, spending keys, and viewing keys."
            >
              <h3 className="mb-4 text-base font-semibold text-foreground">Cryptography</h3>
              <div className="space-y-4">
                {cryptoItems.map((item) => (
                  <DocsSection key={item.id} id={item.id}>
                    <CryptoCard {...item} />
                  </DocsSection>
                ))}
              </div>
              <DocsSection id="key-model" className="pt-10">
                <h3 className="mb-2 text-base font-semibold text-foreground">Key model</h3>
                <p className="mb-5 max-w-2xl text-sm leading-relaxed text-gray">
                  The spending key authorizes transactions. The viewing key finds activity without granting permission to spend.
                </p>
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                  <KeyCard
                    icon={KeyRound}
                    title="Spending Key"
                    desc="Baby Jubjub elliptic curve keypair. Signs all JoinSplit transactions using EdDSA-Poseidon. The nullifier secret is derived from this key, so one 32-byte seed backs up the vault."
                    features={[
                      "Signs transactions (EdDSA-Poseidon)",
                      "Derives the nullifier secret",
                      "Generates the Master Public Key (MPK)",
                    ]}
                  />
                  <KeyCard
                    icon={Eye}
                    title="Viewing Key"
                    desc="Ed25519 keypair used to scan stealth announcements and recover incoming and outgoing history. Sharing it allows read-only access, never spending."
                    features={[
                      "Scans stealth announcements",
                      "Derives the outgoing-viewing key",
                      "Supports selective disclosure",
                    ]}
                  />
                </div>
              </DocsSection>
            </ExpandableSection>

            <ExpandableSection
              id="disclosure"
              title="Audit and disclosure"
              summary="Read-only audit access, sender memos, disclosure proofs, and account settings."
            >
              <p className="mb-5 max-w-2xl text-sm leading-relaxed text-gray">
                Each capability is optional. Review your current setup in{" "}
                <Link href={hrefWithChain("/compliance", network)} className="text-privacy hover:underline">
                  Disclosure status
                </Link>.
              </p>
              <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
                {disclosureItems.map((item) => (
                  <DocsSection key={item.id} id={item.id}>
                    <DisclosureCard {...item} />
                  </DocsSection>
                ))}
              </div>
            </ExpandableSection>

            <ExpandableSection
              id="security"
              title="Security"
              summary="Custody, Bitcoin verification, double-spend prevention, and the on-chain audit trail."
            >
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                {securityItems.map((item) => (
                  <SecurityCard key={item.title} {...item} />
                ))}
              </div>
            </ExpandableSection>

            {/* ── CTA ── */}
            <section className="border-t border-gray/10 py-16 sm:py-20">
              <div className="max-w-3xl mx-auto text-center">
                <h2 className="text-xl sm:text-2xl md:text-3xl font-semibold tracking-tight text-foreground mb-4">
                  Open Your Private Vault
                </h2>
                <p className="text-gray text-xs sm:text-sm font-light mb-6 sm:mb-8 max-w-lg mx-auto leading-relaxed">
                  Deposit or shield supported assets, send privately, cash out to Solana, or withdraw zkBTC to Bitcoin.
                </p>
                <div className="flex flex-col sm:flex-row items-center justify-center gap-3 sm:gap-4">
                  <Link
                    href={hrefWithChain("/vault", network)}
                    className="btn-privacy btn-pill inline-flex items-center gap-2 px-5 sm:px-7 py-2.5 text-sm sm:text-base transition-shadow"
                  >
                    <Shield className="w-4 h-4 sm:w-5 sm:h-5" />
                    Open Private Vault
                    <ArrowRight className="w-4 h-4 sm:w-5 sm:h-5" />
                  </Link>
                  <Link
                    href={hrefWithChain("/explorer", network)}
                    className="btn-tertiary btn-pill inline-flex items-center gap-2 px-4 sm:px-5 py-2.5 text-sm border border-gray/10 hover:bg-muted/50 hover:border-gray/20 transition-all"
                  >
                    View Explorer
                    <ChevronRight className="w-4 h-4" />
                  </Link>
                </div>
              </div>
            </section>
          </div>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
