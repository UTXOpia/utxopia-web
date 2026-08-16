import type { Metadata } from "next";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { SvgDefs } from "@/components/tech/diagram";
import {
  AttestationChain,
  ConsumptionChecks,
  DelegationBoundary,
  IntentBinding,
  Lifecycle,
} from "@/components/tech/magicblock-diagrams";

export const metadata: Metadata = {
  title: "MagicBlock & the Verified pool — UTXOpia",
  description:
    "How a policy approval is delegated to a MagicBlock ephemeral rollup, decided inside a TDX enclave, and committed back to Solana before any asset instruction can consume it.",
};

function Section({
  id,
  eyebrow,
  title,
  plain,
  intro,
  children,
}: {
  id: string;
  eyebrow: string;
  title: string;
  /** One sentence anyone can follow, before the precise version. A reader who
   *  stops here should still have taken the point away. */
  plain: string;
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
      <p className="mt-3 max-w-[38em] text-base leading-relaxed text-gray-light">{plain}</p>
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

export default function MagicBlockPage() {
  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />
      <SvgDefs />

      <div className="mx-auto max-w-4xl px-4 pt-28 pb-4 sm:px-6 sm:pt-32 lg:max-w-5xl lg:px-8">
        <section className="pb-6">
          <Link
            href="/architecture"
            className="inline-flex items-center gap-1.5 text-xs text-gray transition-colors hover:text-foreground"
          >
            <ArrowLeft className="h-3 w-3" />
            Architecture
          </Link>
          <p className="mt-6 font-mono text-[11px] uppercase tracking-[0.18em] text-privacy/70">
            Verified pool
          </p>
          <h1 className="mt-2 text-2xl font-semibold tracking-tight text-foreground sm:text-3xl">
            MagicBlock as a private policy coprocessor
          </h1>
          <p className="mt-5 max-w-[38em] text-lg leading-relaxed text-foreground">
            Some pools have to check a payment against a policy before it is
            allowed. Doing that check on a public blockchain tells everyone you
            asked — before anyone has answered. So the check happens somewhere
            sealed, and only the verdict comes back out.
          </p>
          <p className="mt-4 max-w-[38em] text-sm leading-relaxed text-gray sm:text-base">
            Precisely: the Verified pool needs someone to sign off on a spend
            without that sign-off — or its reasoning — becoming public. UTXOpia
            does that by delegating exactly one account to a MagicBlock ephemeral
            rollup running in a TDX enclave, deciding there, and committing the
            result back to Solana. No asset state ever executes off the base
            layer.
          </p>
          <div className="mt-5 flex flex-wrap gap-2">
            {[
              ["#words", "The words"],
              ["#boundary", "What is delegated"],
              ["#lifecycle", "Lifecycle"],
              ["#binding", "Intent binding"],
              ["#checks", "Consumption"],
              ["#tee", "Attestation"],
            ].map(([href, label]) => (
              <a
                key={href}
                href={href}
                className="rounded-full border border-gray/15 px-3 py-1.5 text-xs text-gray transition-colors hover:border-gray/30 hover:text-foreground"
              >
                {label}
              </a>
            ))}
          </div>
        </section>

        {/* The vocabulary below is unavoidable — it names real things. Defining
            it once up front is cheaper than a reader bouncing off the first
            paragraph that uses it. */}
        <section
          id="words"
          className="scroll-mt-24 border-t border-gray/10 py-10 sm:py-14"
        >
          <h2 className="text-xl font-semibold tracking-tight text-foreground sm:text-2xl">
            The words on this page
          </h2>
          <p className="mt-3 max-w-[38em] text-base leading-relaxed text-gray-light">
            Five terms do most of the work. You can read everything below once
            you have these.
          </p>
          <Facts
            rows={[
              [
                "Ephemeral rollup",
                "A short-lived side environment where a Solana account can be sent to run fast, cheaply and out of public view, then handed back. It borrows the account; it does not replace Solana.",
              ],
              [
                "TDX enclave",
                "A sealed part of a server that even the machine's owner cannot read into, and which can prove to you which code is running inside it.",
              ],
              [
                "PolicyApproval",
                "A single-use permission slip. It says one specific payment is allowed. It holds no money.",
              ],
              [
                "Delegating an account",
                "Temporarily handing one account to the rollup so it can be changed there, then returning it to Solana. Only the permission slip is ever handed over.",
              ],
              [
                "Attestation",
                "The proof that the sealed box is genuine and is running the exact code expected — checked fresh every time, not taken on trust.",
              ],
            ]}
          />
        </section>

        <Section
          id="boundary"
          eyebrow="01"
          title="Only a decision crosses the boundary"
          plain="Your money never leaves Solana. The only thing sent to the rollup is a permission slip that holds no value — so if the rollup fails, the worst case is that the payment simply does not happen."
          intro="An ephemeral rollup is a place where accounts can be delegated for fast, cheap, private execution and then returned. UTXOpia delegates one account type and one only: a single-use PolicyApproval. Everything that represents value stays where it settles."
        >
          <DelegationBoundary />
          <Facts
            rows={[
              ["Why this is safe to delegate", "The approval holds no balance and no note. Worst case for a rollup failure is that an approval never comes back — the spend does not happen, and nothing is lost."],
              ["Why it is worth delegating", "Inside a private ER the decision, its timing and its content are not on a public ledger. On Solana, a pending approval account and its traffic would be a live feed of who is asking for what."],
              ["Permissioned pools only", "PER policy requires the institution privacy domain; the Open (permissionless) pool has no approvals, no auditor and no rollup in its path."],
              ["Rent", "The approval is funded with the PER permission rent up front, so the ER-local permission can be created and closed without a second payer."],
            ]}
          />
        </Section>

        <Section
          id="lifecycle"
          eyebrow="02"
          title="Eleven steps, five of them transactions"
          plain="Creating the slip, deciding on it, and bringing it back takes eleven steps. An approval and a refusal follow exactly the same steps, so nobody watching can tell which one is happening."
          intro="The coordinator creates the approval on Solana, delegates it, opens a private permission inside the rollup, applies the verdict, closes the permission, and commits the account back. Only then can an asset instruction touch it."
        >
          <Lifecycle />
          <Facts
            rows={[
              ["Approvals and refusals are indistinguishable", "Both verdicts take this identical path, so the transaction pattern on Solana cannot be read as an oracle for the decision until the commit."],
              ["A refusal is still an artifact", "A rejected approval lands on chain as a durable, auditable account — it is a record, not a silence."],
              ["The reason stays inside", "What tripped the screen is kept in the coordinator's process and never written to any chain."],
              ["Timing", "Stage marks are recorded in milliseconds, because every interesting interval here is under a second."],
            ]}
          />
        </Section>

        <Section
          id="binding"
          eyebrow="03"
          title="The approval is glued to one specific intent"
          plain="A slip is not a key to the pool. It is welded to one payment — these notes, this amount, this destination — and it is worthless for anything else."
          intro="An approval is not a token that unlocks the pool. It is a commitment to which notes are spent, how much leaves, and where it goes — folded into a hash that sits in the account's own PDA seeds."
        >
          <IntentBinding />
        </Section>

        <Section
          id="checks"
          eyebrow="04"
          title="Consumption is atomic and unforgiving"
          plain="When the payment finally runs, the program re-checks the slip from scratch rather than trusting it. It is used up in the same transaction that moves the money, and there is no override."
          intro="The asset program does not trust the account it was handed. It re-derives the address, recomputes the intent hash, and CPIs into the policy program signed by the pool PDA to burn the approval — all inside the transaction that moves the value."
        >
          <ConsumptionChecks />
          <Facts
            rows={[
              ["Single use", "Consumption flips the status to Consumed via CPI. The same approval cannot cover a second instruction."],
              ["No admin override", "There is no instruction that waives an approval. The policy program re-decides rather than trusting the pool's signature."],
              ["Expiry", "Approvals die by slot, not by wall clock, so a stalled request cannot be replayed later."],
              ["Covered actions", "complete_deposit, shield, transact, unshield and redeem on a permissioned pool. Nothing else consumes approvals."],
            ]}
          />
        </Section>

        <Section
          id="tee"
          eyebrow="05"
          title="Attesting the enclave, not the hostname"
          plain="Before anything is sent, the sealed box has to prove what it is. Being told a server is secure is not evidence; a fresh cryptographic proof of the exact code inside it is."
          intro="Proving that a genuine TDX enclave answered is not the same as proving which code is running inside it. The coordinator verifies a fresh quote against Intel collateral and pins the measurement registers before it will use the endpoint at all."
        >
          <AttestationChain />
          <Facts
            rows={[
              ["Freshness", "A 64-byte challenge goes into each quote, so a cached or replayed attestation does not pass."],
              ["Measurement pinning", "MRTD and the RTMRs are compared against expected values — without that pin, \"TEE\" is just a DNS name."],
              ["TCB policy", "UpToDate and SWHardeningNeeded pass by default; degraded platform states are accepted only if the operator opts in."],
              ["Validator pinning", "The delegation names the TEE validator, so the approval is not executed by an arbitrary ER node."],
            ]}
          />
        </Section>
      </div>

      <SiteFooter />
    </main>
  );
}
