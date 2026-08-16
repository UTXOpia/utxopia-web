"use client";

/**
 * Per-token pool anonymity view.
 *
 * The question this page answers is "if I move this amount, who else could it
 * have been?" — not "how big is the pool". Everything below the personal card
 * is public chain data, so the page stays useful (and shareable) logged out.
 */

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Info, Key } from "lucide-react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { AuthModal } from "@/components/auth-modal";
import { useChainEnvironment } from "@/lib/chain-environment";
import { useSingleTokenActivity } from "@/hooks/use-token-activity";
import { usePayFlowAuth } from "@/hooks/use-pay-flow-auth";
import { useTokenNotes, useUTXOpiaKeys, type InboxNote } from "@/hooks/use-utxopia";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import {
  formatTokenAmount,
  getTokenBySymbol,
  type SupportedToken,
} from "@/lib/supported-tokens";
import { hrefWithChain } from "@/lib/network-config";
import {
  assessNote,
  bucketIndexOf,
  buildHistogram,
  isDecadeEdge,
  SIMILAR_TOLERANCE,
  type DepositPoint,
  type NoteExposure,
} from "@/lib/anonymity";

/** Clock as state, so render stays pure and note ages tick without a reload. */
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

function fmtAge(ms: number) {
  const mins = Math.floor(ms / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/* ── shared shells ───────────────────────────────────────────────────────── */

function Card({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-[18px] border border-gray/15 bg-muted/50 p-6 sm:p-7">
      <h2 className="section-title m-0 text-xl">{title}</h2>
      {subtitle && <p className="m-0 mt-1.5 text-[13.5px] leading-relaxed text-gray">{subtitle}</p>}
      <div className="mt-5">{children}</div>
    </section>
  );
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-xl border border-gray/15 bg-background px-4 py-3.5">
      <div className="font-display text-[24px] font-semibold tracking-tight">{value}</div>
      <div className="mt-0.5 text-[12.5px] text-gray">{label}</div>
      {hint && <div className="mt-1 text-[12px] leading-snug text-gray/70">{hint}</div>}
    </div>
  );
}

/**
 * A rule, not a card. This sits inside a note row which sits inside a section,
 * and giving it its own border and fill made that three nested containers deep
 * — visual noise that competed with the warning instead of carrying it. The
 * accent rule and colour do the same job with one less box.
 *
 * Colour carries severity, so every line states its severity in words too.
 */
function Finding({
  tone,
  children,
}: {
  tone: "warn" | "caution" | "ok";
  children: React.ReactNode;
}) {
  const style =
    tone === "warn"
      ? "border-warning/60 text-warning"
      : tone === "caution"
        ? "border-gray/40 text-gray-light"
        : "border-success/50 text-success";
  return (
    <div
      className={`flex items-start gap-2.5 border-l-2 py-0.5 pl-3 text-[13px] leading-relaxed ${style}`}
    >
      {tone === "warn" ? (
        <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      ) : (
        <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      )}
      <span>{children}</span>
    </div>
  );
}

/* ── amount distribution ─────────────────────────────────────────────────── */

function Distribution({
  deposits,
  token,
  markAmount,
  truncated,
}: {
  deposits: DepositPoint[];
  token: SupportedToken;
  /** The user's amount, highlighted so "am I an outlier" is one glance. */
  markAmount: number | null;
  truncated: boolean;
}) {
  const buckets = useMemo(() => buildHistogram(deposits), [deposits]);
  const marked = markAmount == null ? -1 : bucketIndexOf(buckets, markAmount);
  const peak = Math.max(1, ...buckets.map((b) => b.count));

  if (buckets.length === 0) {
    return <p className="m-0 text-[13.5px] text-gray">No deposits in this pool yet.</p>;
  }

  return (
    <>
      {/* An empty bucket still draws a baseline sliver: a bar of literally zero
          height reads as a hole in the axis rather than as "nothing here". */}
      <div className="flex h-[130px] items-end gap-1.5 border-b border-gray/20">
        {buckets.map((b, i) => (
          <div key={b.lo} className="group relative flex h-full flex-1 flex-col justify-end">
            <div
              className={`rounded-t transition-colors ${
                b.count === 0
                  ? "bg-gray/15"
                  : i === marked
                    ? "bg-privacy"
                    : "bg-gray/30 group-hover:bg-gray/45"
              }`}
              style={{ height: b.count === 0 ? "2px" : `${Math.max(4, (b.count / peak) * 100)}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-gray/20 bg-background px-2 py-1 font-mono text-[12px] text-gray-light group-hover:block">
              {b.count} × {formatTokenAmount(Math.round(b.lo), token)} –{" "}
              {formatTokenAmount(Math.round(b.hi), token)}
            </div>
          </div>
        ))}
      </div>
      {/* A tick is centred on the edge it names, not on the bucket — except the
          first, which would hang off the left of the chart. */}
      <div className="flex h-4 gap-1.5 font-mono text-[12px] text-gray">
        {buckets.map((b, i) => (
          <span key={b.lo} className="relative min-w-0 flex-1">
            {isDecadeEdge(b.lo) && (
              <span
                className={`absolute left-0 top-1 whitespace-nowrap ${i === 0 ? "" : "-translate-x-1/2"}`}
              >
                {formatTokenAmount(Math.round(b.lo), token)}
              </span>
            )}
          </span>
        ))}
      </div>
      <div className="mt-1 text-center font-mono text-[12px] text-gray">
        deposit size · log scale
      </div>
      {marked >= 0 && (
        <p className="m-0 mt-3 text-[12.5px] text-privacy">
          The filled bar is where your largest note sits.
        </p>
      )}
      {truncated && (
        <p className="m-0 mt-2 text-[12px] leading-relaxed text-gray">
          Showing the most recent deposits only — the counts above cover the whole pool, this
          distribution does not.
        </p>
      )}
    </>
  );
}

/* ── your position ───────────────────────────────────────────────────────── */

const BAND_PCT = Math.round(SIMILAR_TOLERANCE * 100);

/** One measurement. `title` carries the long form for anyone who hovers. */
function Chip({
  tone,
  title,
  children,
}: {
  tone: "warn" | "ok";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <span
      title={title}
      className={`cursor-help rounded-md border px-2 py-1 font-mono text-[12px] ${
        tone === "warn"
          ? "border-warning/35 bg-warning/[0.08] text-warning"
          : "border-gray/20 bg-muted/60 text-gray-light"
      }`}
    >
      {children}
    </span>
  );
}

function NoteRow({
  amount,
  token,
  exposure,
  depositsKnown,
}: {
  amount: number;
  token: SupportedToken;
  exposure: NoteExposure;
  /** False when the public deposit list failed to load — every amount-based
   *  count would then read zero, which is a wrong answer, not a safe one. */
  depositsKnown: boolean;
}) {
  // A finding is prose only when it asks the reader to do something. Repeating
  // "this is fine" in full sentences on every note buries the one that isn't.
  const warnings: React.ReactNode[] = [];
  if (!depositsKnown) {
    warnings.push(
      <>
        <strong>Amount checks unavailable.</strong> The public deposit list did not load, so this
        note cannot be compared against the pool. Treat that as unknown, not as safe.
      </>,
    );
  } else {
    if (exposure.isFingerprint) {
      warnings.push(
        <>
          <strong>Unique amount.</strong> Exactly one public deposit carries this figure — almost
          certainly the one that created this note. Withdrawing it in full links the two however
          large the pool is. Split it, or leave a remainder behind.
        </>,
      );
    }
    if (exposure.isSoleSource) {
      warnings.push(
        <>
          <strong>Largest in the pool.</strong> No other deposit is big enough to have funded this
          note on its own, so moving the full amount points at the one that did. Send less than the
          next deposit down, or wait for a larger one to land.
        </>,
      );
    } else if (exposure.isThin) {
      warnings.push(
        <>
          <strong>Thin crowd.</strong> Only {exposure.atLeastCount} deposits are large enough to
          have funded this note, so moving it leaves a short guess-list.
        </>,
      );
    }
  }
  // The age is printed above; only the hour where timing alone pairs a deposit
  // with a withdrawal earns a sentence of its own.
  if (exposure.isVeryRecent) {
    warnings.push(
      <>
        <strong>Under an hour old.</strong> Timing alone pairs a deposit with a withdrawal. Waiting
        is the cheapest privacy you can buy.
      </>,
    );
  }

  return (
    <div className="rounded-xl border border-gray/15 bg-background p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[15px]">{formatTokenAmount(amount, token)}</span>
        <span className="text-[12px] text-gray">held {fmtAge(exposure.ageMs)}</span>
      </div>

      <div className="mt-2.5 flex flex-wrap gap-1.5">
        {!depositsKnown ? (
          <Chip tone="warn" title="The public deposit list did not load.">
            no data
          </Chip>
        ) : (
          <>
            <Chip
              tone={exposure.isFingerprint ? "warn" : "ok"}
              title={
                exposure.isFingerprint
                  ? "Exactly one public deposit carries this amount — almost certainly this note's own."
                  : exposure.exactCount === 0
                    ? "No public deposit carries this exact amount, so a full withdrawal has no deposit to pair against."
                    : `${exposure.exactCount} public deposits carry this exact amount.`
              }
            >
              {exposure.isFingerprint
                ? "unique amount"
                : exposure.exactCount === 0
                  ? "no exact match"
                  : `${exposure.exactCount} exact`}
            </Chip>
            {/* Informational only: a small note having no same-size neighbours
                is normal and says nothing about the real candidate set. */}
            <Chip
              tone="ok"
              title={`Public deposits within ±${BAND_PCT}% of this amount — the band an observer allows for fees when matching a whole deposit to a whole withdrawal.`}
            >
              {exposure.similarCount} look-alike{exposure.similarCount === 1 ? "" : "s"}
            </Chip>
            <Chip
              tone={exposure.isThin ? "warn" : "ok"}
              title="Public deposits at least this size. Any one of them could have funded this note on its own, so it is the candidate list an observer starts from. Smaller deposits can still combine, so it is not a floor."
            >
              {exposure.atLeastCount} big enough
            </Chip>
          </>
        )}
      </div>

      {warnings.length > 0 && (
        <div className="mt-2.5 flex flex-col gap-2">
          {warnings.map((w, i) => (
            <Finding key={i} tone="warn">
              {w}
            </Finding>
          ))}
        </div>
      )}
    </div>
  );
}

function YourPosition({
  token,
  notes,
  notesLoading,
  deposits,
  depositsKnown,
  vaultHref,
}: {
  token: SupportedToken;
  notes: InboxNote[];
  notesLoading: boolean;
  deposits: DepositPoint[];
  depositsKnown: boolean;
  vaultHref: string;
}) {
  const { hasKeys, isLoading: keysLoading, error: keysError, deriveKeys } = useUTXOpiaKeys();
  const wallet = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const loadViewOnlyKeys = useUTXOpiaStore((s) => s.loadViewOnlyKeys);
  // autoOpen off: this page is meant to be readable signed out, so the modal
  // opens only when the user asks for it.
  const auth = usePayFlowAuth(hasKeys, { autoOpen: false });
  const now = useNow();

  if (!hasKeys) {
    return (
      <Card
        title="Your position"
        subtitle={`Unlock to check how exposed your own ${token.symbol} is. Everything below this card is public and needs no wallet.`}
      >
        <div className="flex flex-col items-start gap-3.5 rounded-xl border border-gray/15 bg-background p-5">
          <p className="m-0 text-[13.5px] leading-relaxed text-gray">
            Your notes are decrypted in your browser. Which amount you hold is never sent anywhere —
            the check runs locally against the public deposit list.
          </p>
          {/* Not a WalletButton: a connected wallet still has no vault keys until
              they are derived, and that button would keep saying "Connect". */}
          <button
            type="button"
            onClick={() => auth.setAuthModalOpen(true)}
            disabled={keysLoading}
            className="btn-privacy inline-flex items-center gap-2"
          >
            <Key className="h-4 w-4" />
            {keysLoading ? "Unlocking…" : "Unlock private vault"}
          </button>
        </div>
        <AuthModal
          open={auth.authModalOpen}
          onOpenChange={auth.setAuthModalOpen}
          auth={{
            passkeySupported: auth.passkeySupported,
            hasPasskeyCredential: auth.hasPasskeyCredential,
            passkeyLoading: auth.passkeyLoading,
            walletLoading: keysLoading,
            walletConnected: wallet.connected,
            error: keysError || auth.passkeyError,
            onPasskeyRegister: () => void auth.handlePasskeyRegister(),
            onPasskeyAuthenticate: () => void auth.handlePasskeyAuthenticate(),
            onWalletConnect: () => {
              auth.setAuthModalOpen(false);
              setWalletModalVisible(true);
            },
            onWalletDeriveKeys: async () => {
              await deriveKeys();
              auth.setAuthModalOpen(false);
            },
            onViewOnlyLogin: (viewingKey) => {
              void loadViewOnlyKeys(viewingKey);
              auth.setAuthModalOpen(false);
            },
          }}
        />
      </Card>
    );
  }

  if (notesLoading || now == null) {
    return (
      <Card title="Your position">
        <div className="h-24 animate-pulse rounded-xl bg-gray/[0.06]" />
      </Card>
    );
  }

  if (notes.length === 0) {
    return (
      <Card title="Your position">
        <div className="flex flex-col items-start gap-3.5 rounded-xl border border-dashed border-gray/20 bg-background p-5">
          <p className="m-0 text-[13.5px] text-gray">You hold no {token.symbol} in this pool.</p>
          <Link href={vaultHref} prefetch={false} className="btn-privacy">
            Shield {token.symbol}
          </Link>
        </div>
      </Card>
    );
  }

  return (
    <Card
      title="Your position"
      subtitle={
        depositsKnown
          ? `${notes.length} unspent note${notes.length === 1 ? "" : "s"}, checked against the public deposit list in your browser.`
          : `${notes.length} unspent note${notes.length === 1 ? "" : "s"}.`
      }
    >
      <div className="flex flex-col gap-3">
        {notes.map((note) => (
          <NoteRow
            key={note.id}
            amount={Number(note.amount)}
            token={token}
            exposure={assessNote(Number(note.amount), note.createdAt, deposits, now)}
            depositsKnown={depositsKnown}
          />
        ))}
      </div>

      {/* Defined once. These terms mean the same thing on every note, so
          repeating them per row pushed the one warning that matters off screen. */}
      {depositsKnown && (
        <dl className="m-0 mt-4 flex flex-col gap-1.5 text-[12.5px] leading-relaxed text-gray">
          <div>
            <dt className="inline font-mono text-gray-light">exact</dt>{" "}
            <dd className="m-0 inline">
              — public deposits carrying this figure precisely. One means the note&apos;s own
              deposit, which a full withdrawal pairs straight back to it.
            </dd>
          </div>
          <div>
            <dt className="inline font-mono text-gray-light">look-alikes</dt>{" "}
            <dd className="m-0 inline">
              — deposits within ±{BAND_PCT}% of it, the band an observer allows for fees. This is
              the crowd a size-based match has to pick from.
            </dd>
          </div>
          <div>
            <dt className="inline font-mono text-gray-light">big enough</dt>{" "}
            <dd className="m-0 inline">
              — deposits at least this size. Moving an amount means at least that much went in, so
              anything smaller drops off the list outright. Several smaller deposits can still
              combine, so treat it as where an observer starts, not as a floor.
            </dd>
          </div>
        </dl>
      )}
    </Card>
  );
}

/* ── page ────────────────────────────────────────────────────────────────── */

const LEAKS: [string, string][] = [
  [
    "The amount.",
    "Deposits are public and exact. Withdraw the same figure you put in and the pair is obvious no matter how many other people are in the tree.",
  ],
  [
    "The clock.",
    "A withdrawal minutes after a deposit has a very short list of candidates. Time is the cheapest thing you can add.",
  ],
  [
    "The addresses.",
    "Withdrawing to the address you deposited from, or to one already linked to it, undoes the pool entirely.",
  ],
  [
    "The crowd size.",
    "Real, but last. It only starts to matter once the three above are handled.",
  ],
];

export default function PoolTokenPage() {
  const params = useParams<{ token: string }>();
  const token = getTokenBySymbol((params?.token ?? "").toUpperCase());

  const { networkId, vaultId } = useChainEnvironment();
  const { activity, isLoading, error } = useSingleTokenActivity(token?.symbol ?? "", vaultId);
  const { availableNotes, isLoading: notesLoading } = useTokenNotes(token?.shieldedSymbol ?? "");

  if (!token || !token.enabled) {
    notFound();
  }

  const chainHref = (href: string) => hrefWithChain(href, networkId);
  const deposits = activity?.deposits ?? [];
  const depositsKnown = !isLoading && !error && activity != null;
  const vaultLabel = vaultId === "verified" ? "Verified" : "Open";
  const largestNote = availableNotes.reduce(
    (max: number | null, n) => (max == null || Number(n.amount) > max ? Number(n.amount) : max),
    null,
  );

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto max-w-[900px] px-6 pb-24 pt-28 sm:px-8">
        <Link
          href={chainHref("/")}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>

        <header className="mb-8 mt-4 flex flex-wrap items-center gap-4">
          <img src={token.logo} alt="" className="h-11 w-11 rounded-full" />
          <div>
            <h1 className="section-title m-0 text-[30px] leading-tight">{token.name}</h1>
            <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[12px] text-gray">
              <span>{token.symbol}</span>
              <span className="text-gray/40">·</span>
              <span>{vaultLabel} pool</span>
              <span className="text-gray/40">·</span>
              <span>{networkId.toUpperCase()}</span>
            </div>
          </div>
        </header>

        <div className="flex flex-col gap-5">
          <YourPosition
            token={token}
            notes={availableNotes}
            notesLoading={notesLoading}
            deposits={deposits}
            depositsKnown={depositsKnown}
            vaultHref={chainHref("/vault")}
          />

          <Card
            title="This pool, in public"
            subtitle={`Every figure here is already on chain. It describes the ${vaultLabel} pool only — the other pool has its own tree, and its depositors do not hide you.`}
          >
            {isLoading ? (
              <div className="h-24 animate-pulse rounded-xl bg-gray/[0.06]" />
            ) : error || !activity ? (
              <p className="m-0 text-[13.5px] text-gray">Pool activity is unavailable right now.</p>
            ) : (
              <>
                <div className="grid gap-2.5 sm:grid-cols-3">
                  <Stat
                    label={`${token.symbol} deposits in`}
                    value={activity.depositCount.toLocaleString()}
                  />
                  <Stat
                    label="Withdrawals out"
                    value={activity.withdrawCount.toLocaleString()}
                    hint="Which deposit each one spent is not knowable — that is the point of the pool."
                  />
                  <Stat
                    label="Shielded now"
                    value={formatTokenAmount(Number(activity.totalShielded), token)}
                  />
                </div>

                <div className="mt-6">
                  <h3 className="m-0 mb-3 text-[14px] font-semibold">Deposit sizes</h3>
                  <Distribution
                    deposits={deposits}
                    token={token}
                    markAmount={largestNote}
                    truncated={activity.depositsTruncated}
                  />
                </div>
              </>
            )}
          </Card>

          <Card
            title="What actually gives you away"
            subtitle="Ranked by how often it is the thing that breaks anonymity. Pool size is not first."
          >
            <div className="flex flex-col gap-2.5">
              {/* A ranked list, so it is built as one — dividers and the number
                  carry the order. Boxing each entry made four cards inside a
                  card and implied four separate objects rather than a sequence. */}
              {LEAKS.map(([lead, rest], i) => (
                <div
                  key={lead}
                  className="flex items-baseline gap-3 border-t border-gray/12 py-3 first:border-t-0 first:pt-0"
                >
                  <span className="font-mono text-[12px] text-privacy">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="m-0 text-[13.5px] leading-relaxed text-gray">
                    <span className="font-semibold text-foreground">{lead}</span> {rest}
                  </p>
                </div>
              ))}
            </div>

            <p className="m-0 mt-5 text-[12.5px] leading-relaxed text-gray">
              On what these counts mean: cryptographically your note hides among every commitment in
              the tree, not just this token&apos;s. The page counts per token because that is what an
              observer actually works with — deposits are public with their token and amount
              attached, so matching starts there.
            </p>
          </Card>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
