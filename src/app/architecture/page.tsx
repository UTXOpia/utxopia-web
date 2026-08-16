import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SvgDefs } from "@/components/tech/diagram";
import {
  DepositFlow,
  JoinSplitDiagram,
  SystemMap,
  WithdrawFlow,
} from "@/components/tech/architecture-diagrams";

export const metadata: Metadata = {
  title: "Architecture — UTXOpia",
  description:
    "How bitcoin becomes a shielded note on Solana: SPV deposits, the JoinSplit circuit, and Ika threshold custody of the vault.",
};

/* ── prose helpers ── */

function Section({
  id,
  eyebrow,
  title,
  intro,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  intro: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-gray/10 py-10 sm:py-14">
      <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-privacy/70">
        {eyebrow}
      </p>
      <h2 className="mt-2 text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
        {title}
      </h2>
      <p className="mt-3 max-w-[38em] text-sm leading-relaxed text-gray">{intro}</p>
      {children}
    </section>
  );
}

function Facts({ rows }: { rows: [string, string][] }) {
  return (
    <dl className="mt-6 grid gap-px overflow-hidden rounded-xl border border-gray/10 bg-gray/10 sm:grid-cols-2">
      {rows.map(([k, v]) => (
        <div key={k} className="bg-background px-4 py-3">
          <dt className="font-mono text-[11px] uppercase tracking-[0.12em] text-gray/70">
            {k}
          </dt>
          <dd className="mt-1 text-[13px] leading-relaxed text-gray-light">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/* ── page ── */

export default function ArchitecturePage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <SvgDefs />

      <div className="mx-auto max-w-4xl px-4 pt-28 pb-4 sm:px-6 sm:pt-32 lg:max-w-5xl lg:px-8">
        <section className="pb-6">
          <p className="font-mono text-[11px] uppercase tracking-[0.18em] text-privacy/70">
            Technical overview
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            How bitcoin becomes a shielded note on Solana
          </h1>
          <p className="mt-4 max-w-[38em] text-sm leading-relaxed text-gray sm:text-base">
            Four moving parts: an SPV light client that lets Solana read Bitcoin,
            a Groth16 JoinSplit circuit that moves value without naming it, an
            Ika dWallet that holds the vault under threshold custody, and — on
            the Verified pool only — a MagicBlock rollup where approvals are
            decided in private.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {[
              ["#system", "System map"],
              ["#deposit", "Deposit"],
              ["#zk", "JoinSplit"],
              ["#ika", "Ika vault"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="rounded-full border border-gray/15 px-3 py-1.5 text-xs text-gray transition-colors hover:border-gray/30 hover:text-foreground"
              >
                {label}
              </a>
            ))}
            <Link
              href="/architecture/magicblock"
              className="inline-flex items-center gap-1.5 rounded-full border border-privacy/30 bg-privacy/10 px-3 py-1.5 text-xs text-privacy transition-colors hover:bg-privacy/15"
            >
              MagicBlock &amp; the Verified pool
              <ArrowRight className="h-3 w-3" />
            </Link>
          </div>
        </section>

        <Section
          id="system"
          eyebrow="01"
          title="The four planes"
          intro="Bitcoin holds the coins. Solana holds the proofs, the tree and the accounting. Off-chain services relay between them but are never trusted with either. The rollup holds one thing only — a policy decision — and gives it back."
        >
          <SystemMap />
          <Facts
            rows={[
              ["Trust boundary", "Backend services can stall a deposit or a withdrawal; they cannot mint, move or de-anonymise anything. Every value-bearing step is re-derived on chain."],
              ["Two pools", "Open (permissionless) and Verified run identical cryptography with different admission rules, separate trees and separate anonymity sets."],
              ["Per-pool custody", "Each pool has its own Ika dWallet, pinned by a dwallet_binding PDA, so one pool's redemption can never spend another's bitcoin."],
              ["Assets", "zkBTC from bitcoin deposits; wSOL, USDC and USDT shielded directly on Solana."],
            ]}
          />
        </Section>

        <Section
          id="deposit"
          eyebrow="02"
          title="Deposit — Bitcoin to Solana"
          intro="The depositor picks a note key, sends to a Taproot address tweaked by it, and puts the ephemeral key and the note key in an OP_RETURN. Everything after that is verification: the program reads the amount and the note key out of an SPV-proven transaction and computes the commitment itself."
        >
          <DepositFlow />
          <Facts
            rows={[
              ["Why OP_RETURN", "It carries the ephemeral pubkey and note pubkey to the chain, so the program can recompute the commitment without the backend asserting anything."],
              ["Why a sweep", "The deposit address is per-note. Sweeping consolidates into the pool's dWallet UTXO set, which is what withdrawals later spend."],
              ["Confirmations", "6 on mainnet-style builds, 1 on devnet builds, checked against the light client's tip height."],
              ["Collateral invariant", "vault == total_shielded + fees. zkBTC is minted only against an SPV-verified deposit and burned only on a completed redemption."],
            ]}
          />
        </Section>

        <Section
          id="zk"
          eyebrow="03"
          title="The zero-knowledge part"
          intro="Every private movement is a JoinSplit: spend n notes, create m notes, prove the arithmetic without revealing it. The circuit is compiled per shape — 45 variants covering n + m ≤ 10 — and the verifying key is fetched on chain from a registry keyed by that shape."
        >
          <JoinSplitDiagram />
          <Facts
            rows={[
              ["Proof system", "Groth16 over BN254, verified with Solana's alt_bn128 syscalls. Proving runs in the browser (WASM) or a Node subprocess."],
              ["Double-spend", "A nullifier is not a list lookup — it is a PDA. Spending twice means creating the same account twice, which the runtime refuses."],
              ["boundParamsHash", "Binds the proof to the fee, the destination, the pool and the tree. Re-targeting a valid proof invalidates it."],
              ["Tree", "Poseidon Merkle tree, depth 16, rotated when full; proofs against frozen trees stay valid."],
            ]}
          />
        </Section>

        <Section
          id="ika"
          eyebrow="04"
          title="Ika — who can move the vault"
          intro="The vault's Bitcoin key exists only as shares across the Ika network. The Solana program is the sole party that can ask for a signature, and it only asks after rebuilding the exact sighash from state it already trusts."
        >
          <WithdrawFlow />
          <Facts
            rows={[
              ["The signing principal", "The dWallet's authority is a PDA of the UTXOpia program. A human operator holding every backend key still cannot get a signature."],
              ["No signing oracle", "The backend supplies a sighash, but step 6 reconstructs it from the reserved UTXOs and the recipient script and rejects any mismatch — so the program cannot be asked to sign an arbitrary message."],
              ["Reserved inputs", "mark_processing reserves UtxoRecord PDAs seeded by the pool, so a redemption can only ever spend its own pool's coins."],
              ["Ragequit", "Exit to a pre-registered destination is always available and needs no approval — nobody can be stranded by a policy or a service outage."],
            ]}
          />
        </Section>

        <section className="border-t border-gray/10 py-10 sm:py-14">
          <h2 className="text-xl font-semibold tracking-tight text-foreground">
            Next: private policy on the Verified pool
          </h2>
          <p className="mt-3 max-w-[38em] text-sm leading-relaxed text-gray">
            Everything above is common to both pools. The Verified pool adds one
            more step before an asset instruction runs — an approval that is
            decided inside a MagicBlock ephemeral rollup and committed back to
            Solana as a durable artifact.
          </p>
          <Link
            href="/architecture/magicblock"
            className="mt-5 inline-flex items-center gap-2 rounded-full bg-foreground px-4 py-2.5 text-xs font-semibold text-background transition-colors hover:bg-white"
          >
            How MagicBlock works here
            <ArrowRight className="h-3.5 w-3.5" />
          </Link>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
