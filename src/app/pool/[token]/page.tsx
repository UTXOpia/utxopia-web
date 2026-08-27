"use client";

/**
 * Per-token pool anonymity view.
 *
 * The question this page answers is "if I move this amount, who else could it
 * have been?" — not "how big is the pool".
 *
 * The layout carries that meaning. Exactly one thing on the page is boxed and
 * tinted: your own position. Everything else — counts, distributions, arrival
 * rate — sits open on the page ground, because it is public chain data that any
 * observer already holds. Three identical cards said the opposite: that your
 * amounts and theirs have the same standing.
 *
 * Colour follows the same rule. Privacy purple means "this is yours"; the crowd
 * is grey; warning means "this needs a decision from you". Nothing is coloured
 * for emphasis alone.
 */

import React, { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { notFound, useParams } from "next/navigation";
import { AlertTriangle, ArrowLeft, Key, ShieldCheck, Unlock } from "lucide-react";
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
import { hrefWithChain, type NetworkId } from "@/lib/network-config";
import {
  getVaultRuntimeConfig,
  hrefWithVault,
  vaultsSupported,
  type VaultId,
} from "@/lib/vault-config";
import {
  assessNote,
  bucketIndexOf,
  buildDailyActivity,
  buildHistogram,
  countDepositsSince,
  DAY_MS,
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

/** The amount without its unit — an axis repeats its ticks five times and the
 *  unit is already named in the caption. */
function bareAmount(raw: number, token: SupportedToken) {
  return formatTokenAmount(raw, token).replace(` ${token.unit}`, "");
}

/* ── shared shells ───────────────────────────────────────────────────────── */

/**
 * A page section. `yours` boxes and tints it — the page's one rule, that
 * exactly one section holds your own data and everything else is public, so
 * the two cannot drift apart in separate components.
 */
function Section({
  title,
  subtitle,
  yours,
  children,
}: {
  title: string;
  subtitle?: string;
  yours?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section
      className={yours ? "rounded-[18px] border border-privacy/25 bg-muted/50 p-6 sm:p-7" : ""}
    >
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 className="section-title m-0 text-xl">{title}</h2>
        {yours && (
          <span className="font-mono text-[11px] tracking-[0.08em] text-privacy">
            IN YOUR BROWSER
          </span>
        )}
      </div>
      {subtitle && (
        <p className="m-0 mt-1.5 max-w-[74ch] text-[13.5px] leading-relaxed text-gray">{subtitle}</p>
      )}
      <div className="mt-5">{children}</div>
    </section>
  );
}

/** One cell of a ruled strip. The strip's gap draws the dividers, so cells
 *  carry no borders of their own and re-flow at any column count. */
function Metric({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 bg-muted px-5 py-4">
      <div className="font-display text-[22px] font-semibold leading-tight tracking-tight tabular-nums break-words sm:text-[26px]">
        {value}
      </div>
      <div className="mt-0.5 text-[12.5px] text-gray">{label}</div>
      {hint && <div className="mt-1 text-[12px] leading-snug text-gray">{hint}</div>}
    </div>
  );
}

/**
 * A rule, not a card. This sits inside a note row which sits inside a section,
 * and giving it its own border and fill made that three nested containers deep
 * — visual noise that competed with the warning instead of carrying it.
 *
 * Colour carries severity, so every line states its severity in words too.
 */
function Finding({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex items-start gap-2.5 border-l border-warning/60 py-0.5 pl-3 text-[13px] leading-relaxed text-warning">
      <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}

/* ── amount distribution ─────────────────────────────────────────────────── */

/** Above this, per-bucket ticks and counts collide; fall back to decade ticks. */
const SPARSE_BUCKETS = 8;

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
  // Few buckets: label every edge and print each bar's count. Hover-only
  // numbers left a touch reader with a chart carrying no values at all, and
  // a decade-only axis can label a four-bucket chart exactly once.
  const sparse = buckets.length > 0 && buckets.length <= SPARSE_BUCKETS;

  if (buckets.length === 0) {
    return <p className="m-0 text-[13.5px] text-gray">No deposits in this pool yet.</p>;
  }

  const total = buckets.reduce((n, b) => n + b.count, 0);
  const filled = buckets.filter((b) => b.count > 0);
  const top = filled.reduce((a, b) => (b.count > a.count ? b : a), filled[0]);

  return (
    <figure className="m-0">
      <div
        className="flex h-[150px] items-end gap-1.5"
        role="img"
        aria-label={buckets
          .map(
            (b) =>
              `${b.count} between ${bareAmount(b.lo, token)} and ${bareAmount(b.hi, token)} ${token.unit}`,
          )
          .join("; ")}
      >
        {/* An empty bucket still draws a baseline sliver: a bar of literally zero
            height reads as a hole in the axis rather than as "nothing here". */}
        {buckets.map((b, i) => (
          <div key={b.lo} className="group relative flex h-full flex-1 flex-col justify-end">
            {sparse && (
              <span
                className={`mb-1.5 text-center font-mono text-[11px] tabular-nums ${
                  i === marked ? "text-privacy" : "text-gray"
                }`}
              >
                {b.count || ""}
              </span>
            )}
            <div
              className={`mx-auto w-full max-w-[120px] rounded-t transition-colors ${
                b.count === 0
                  ? "bg-gray/15"
                  : i === marked
                    ? "bg-privacy"
                    : "bg-gray/30 group-hover:bg-gray/45"
              }`}
              style={{ height: b.count === 0 ? "2px" : `${Math.max(4, (b.count / peak) * 100)}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-gray/20 bg-background px-2 py-1 font-mono text-[12px] text-gray-light group-hover:block">
              {b.count} × {bareAmount(b.lo, token)} – {bareAmount(b.hi, token)}
            </div>
          </div>
        ))}
      </div>

      {/* A tick names a bucket edge, so it sits on the boundary it labels — bar
          centres would claim the range is a single value. The first would hang
          off the left of the chart, and the closing edge belongs to no bucket,
          so it is pinned to the right instead. */}
      <div className="relative flex h-5 gap-1.5 border-t border-gray/20 font-mono text-[11px] tabular-nums text-gray">
        {buckets.map((b, i) => (
          <span key={b.lo} className="relative min-w-0 flex-1">
            {(sparse || isDecadeEdge(b.lo)) && (
              <span
                className={`absolute left-0 top-1.5 whitespace-nowrap ${i === 0 ? "" : "-translate-x-1/2"}`}
              >
                {bareAmount(b.lo, token)}
              </span>
            )}
          </span>
        ))}
        {sparse && (
          <span className="absolute right-0 top-1.5 whitespace-nowrap">
            {bareAmount(buckets[buckets.length - 1].hi, token)}
          </span>
        )}
      </div>

      <figcaption className="mt-3 font-mono text-[11.5px] text-gray">
        deposit size · {token.unit} · log scale
      </figcaption>
      <p className="m-0 mt-2 max-w-[60ch] text-[12.5px] leading-relaxed text-gray">
        {filled.length === 1 ? (
          <>
            All {total} deposits fall in one size band, so size alone tells nobody here apart.
          </>
        ) : (
          <>
            {top.count} of {total} deposits sit in one band ({bareAmount(top.lo, token)}–
            {bareAmount(top.hi, token)}) — the largest crowd a size match has to sift.
          </>
        )}
      </p>
      {marked >= 0 && (
        <p className="m-0 mt-1.5 text-[12.5px] leading-relaxed text-privacy">
          The filled bar is where your largest note sits.
        </p>
      )}
      {truncated && (
        <p className="m-0 mt-2 max-w-[60ch] text-[12px] leading-relaxed text-gray">
          Showing the most recent deposits only — the counts above cover the whole pool, this
          distribution does not.
        </p>
      )}
    </figure>
  );
}

/* ── arrival rate ────────────────────────────────────────────────────────── */

const ACTIVITY_DAYS = 14;

const fmtDay = (ms: number) =>
  new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Deposits per day.
 *
 * The size histogram answers "who else looks like me". This answers "will
 * waiting buy me anyone new" — the question behind every piece of advice on
 * this page that ends in "wait". A flat run of empty days is the honest answer
 * that it will not, and the line beneath says so in words rather than leaving
 * it to be read off the bars.
 */
function Arrivals({ deposits, now }: { deposits: DepositPoint[]; now: number | null }) {
  const days = useMemo(
    () => (now == null ? [] : buildDailyActivity(deposits, now, ACTIVITY_DAYS)),
    [deposits, now],
  );

  if (now == null) return <div className="h-[150px] animate-pulse rounded-xl bg-gray/[0.06]" />;
  // Every deposit predates the indexer's block times — drawing an empty chart
  // would claim the pool is idle, which is a different statement from "unknown".
  if (deposits.length > 0 && !deposits.some((d) => d.blockTime > 0)) {
    return (
      <p className="m-0 text-[13.5px] text-gray">
        Arrival times are not recorded for this pool&apos;s deposits.
      </p>
    );
  }

  const total = days.reduce((n, d) => n + d.count, 0);
  const peak = Math.max(1, ...days.map((d) => d.count));

  return (
    <figure className="m-0">
      <div
        className="flex h-[150px] items-end gap-1.5"
        role="img"
        aria-label={`${total} deposits over the last ${ACTIVITY_DAYS} days, ${peak} on the busiest day`}
      >
        {days.map((d) => (
          <div key={d.start} className="group relative flex h-full flex-1 flex-col justify-end">
            <div
              className={`rounded-t transition-colors ${
                d.count === 0 ? "bg-gray/15" : "bg-gray/30 group-hover:bg-gray/45"
              }`}
              style={{ height: d.count === 0 ? "2px" : `${Math.max(6, (d.count / peak) * 100)}%` }}
            />
            <div className="pointer-events-none absolute bottom-full left-1/2 z-10 mb-1.5 hidden -translate-x-1/2 whitespace-nowrap rounded-md border border-gray/20 bg-background px-2 py-1 font-mono text-[12px] text-gray-light group-hover:block">
              {d.count} on {fmtDay(d.start)}
            </div>
          </div>
        ))}
      </div>

      <div className="flex h-5 justify-between border-t border-gray/20 pt-1.5 font-mono text-[11px] text-gray">
        <span>{fmtDay(days[0].start)}</span>
        <span>today</span>
      </div>

      <figcaption className="mt-3 font-mono text-[11.5px] text-gray">
        deposits per day · {ACTIVITY_DAYS} days
      </figcaption>
      <p className="m-0 mt-2 max-w-[60ch] text-[12.5px] leading-relaxed text-gray">
        {total === 0 ? (
          <>
            Nobody has joined in {ACTIVITY_DAYS} days. Waiting adds no cover here until someone
            does.
          </>
        ) : (
          <>
            {total} deposit{total === 1 ? "" : "s"} in {ACTIVITY_DAYS} days, {peak} on the busiest
            day.
          </>
        )}
      </p>
    </figure>
  );
}

/* ── pool picker ─────────────────────────────────────────────────────────── */

const VAULT_PILLS: { id: VaultId; label: string; icon: typeof Unlock }[] = [
  { id: "open", label: "Open", icon: Unlock },
  { id: "verified", label: "Verified", icon: ShieldCheck },
];

/**
 * Links, not state: the pool lives in the URL, so a view stays shareable and
 * the back button means what it looks like it means.
 *
 * Each pill carries its own deposit count. A count that only appears after you
 * switch cannot help you decide to switch, and the crowd is the entire reason
 * to care which pool you are standing in.
 */
function PoolPicker({
  networkId,
  active,
  href,
  counts,
}: {
  networkId: NetworkId;
  active: VaultId;
  href: (vault: VaultId) => string;
  counts: Record<VaultId, number | null>;
}) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-gray/15 bg-muted/40 p-0.5">
      {VAULT_PILLS.map(({ id, label, icon: Icon }) => {
        const vault = getVaultRuntimeConfig(networkId, id);
        const isActive = id === active;
        const count = counts[id];
        return (
          <Link
            key={id}
            href={href(id)}
            prefetch={false}
            scroll={false}
            aria-current={isActive ? "page" : undefined}
            title={`${vault.name} — ${vault.description}`}
            className={`flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] font-medium transition-colors ${
              isActive
                ? "border border-gray/20 bg-background text-foreground"
                : "border border-transparent text-gray hover:text-foreground"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
            <span
              className={`font-mono text-[12px] tabular-nums ${isActive ? "text-gray-light" : "text-gray"}`}
            >
              {count == null ? "–" : count.toLocaleString()}
            </span>
          </Link>
        );
      })}
    </div>
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
      className={`cursor-help rounded-md border px-2 py-1 font-mono text-[12px] tabular-nums ${
        tone === "warn"
          ? "border-warning/35 bg-warning/[0.08] text-warning"
          : "border-gray/20 bg-background text-gray-light"
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
  timesKnown,
}: {
  amount: number;
  token: SupportedToken;
  exposure: NoteExposure;
  /** False when the public deposit list failed to load — every amount-based
   *  count would then read zero, which is a wrong answer, not a safe one. */
  depositsKnown: boolean;
  /** False when no deposit carries a block time; every timing count would then
   *  read zero and cry "nobody joined" at a pool that is perfectly busy. */
  timesKnown: boolean;
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
  // Age is a proxy; arrivals are the thing itself. A week-old note in a pool
  // nobody has touched since is more exposed than an hour-old one in a busy
  // pool, and only this line says so.
  if (timesKnown && exposure.isUnjoined) {
    warnings.push(
      <>
        <strong>Nothing has joined since.</strong> No deposit has landed in this pool after this
        note, so a withdrawal now is the next event after its own deposit — waiting longer buys
        nothing until someone else arrives.
      </>,
    );
  }

  return (
    <div className="border-t border-gray/15 py-4 first:border-t-0 first:pt-0">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="font-mono text-[15px] tabular-nums">
          {formatTokenAmount(amount, token)}
        </span>
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
            {timesKnown && (
              <Chip
                tone={exposure.isUnjoined ? "warn" : "ok"}
                title="Deposits that landed after this note was created. They are the arrivals a withdrawal can hide behind in time — with none, its withdrawal is the next thing to happen after its own deposit."
              >
                {exposure.laterCount} joined since
              </Chip>
            )}
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
        <div className="mt-3 flex flex-col gap-2">
          {warnings.map((w, i) => (
            <Finding key={i}>{w}</Finding>
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
  timesKnown,
  vaultHref,
  now,
}: {
  token: SupportedToken;
  notes: InboxNote[];
  notesLoading: boolean;
  deposits: DepositPoint[];
  depositsKnown: boolean;
  timesKnown: boolean;
  vaultHref: string;
  /** The page's clock, so note ages and the 7-day count tick together. */
  now: number | null;
}) {
  const { hasKeys, isLoading: keysLoading, error: keysError } = useUTXOpiaKeys();
  const loadViewOnlyKeys = useUTXOpiaStore((s) => s.loadViewOnlyKeys);
  // autoOpen off: this page is meant to be readable signed out, so the modal
  // opens only when the user asks for it.
  const auth = usePayFlowAuth(hasKeys, { autoOpen: false });

  if (!hasKeys) {
    return (
      <Section
        yours
        title="Your position"
        subtitle={`Unlock to check how exposed your own ${token.symbol} is. Notes are decrypted on this device — which amount you hold is never sent anywhere, and every check below runs against the public deposit list locally.`}
      >
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
        <AuthModal
          open={auth.authModalOpen}
          onOpenChange={auth.setAuthModalOpen}
          auth={{
            error: keysError || auth.passkeyError,
            onViewOnlyLogin: (viewingKey) => {
              void loadViewOnlyKeys(viewingKey);
              auth.setAuthModalOpen(false);
            },
          }}
        />
      </Section>
    );
  }

  if (notesLoading || now == null) {
    return (
      <Section yours title="Your position">
        <div className="h-24 animate-pulse rounded-xl bg-gray/[0.06]" />
      </Section>
    );
  }

  if (notes.length === 0) {
    return (
      <Section yours title="Your position" subtitle={`You hold no ${token.symbol} in this pool.`}>
        <Link href={vaultHref} prefetch={false} className="btn-privacy">
          Shield {token.symbol}
        </Link>
      </Section>
    );
  }

  return (
    <Section
      yours
      title="Your position"
      subtitle={
        depositsKnown
          ? `${notes.length} unspent note${notes.length === 1 ? "" : "s"}, checked against the public deposit list without leaving this device.`
          : `${notes.length} unspent note${notes.length === 1 ? "" : "s"}.`
      }
    >
      <div className="flex flex-col">
        {notes.map((note) => (
          <NoteRow
            key={note.id}
            amount={Number(note.amount)}
            token={token}
            exposure={assessNote(Number(note.amount), note.createdAt, deposits, now)}
            depositsKnown={depositsKnown}
            timesKnown={timesKnown}
          />
        ))}
      </div>

      {/* Defined once. These terms mean the same thing on every note, so
          repeating them per row pushed the one warning that matters off screen. */}
      {depositsKnown && (
        <dl className="m-0 mt-5 flex max-w-[74ch] flex-col gap-1.5 border-t border-gray/15 pt-4 text-[12.5px] leading-relaxed text-gray">
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
          {timesKnown && (
            <div>
              <dt className="inline font-mono text-gray-light">joined since</dt>{" "}
              <dd className="m-0 inline">
                — deposits that landed after this note. Time orders the ledger too: with none, the
                withdrawal is simply the next event after the deposit.
              </dd>
            </div>
          )}
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
    </Section>
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
  ["The crowd size.", "Real, but last. It only starts to matter once the three above are handled."],
];

export default function PoolTokenPage() {
  const params = useParams<{ token: string }>();
  // No case normalising: the lookup handles it, and upper-casing the slug is
  // what hid zkBTC behind a 404.
  const token = getTokenBySymbol(params?.token ?? "");

  const { networkId, vaultId } = useChainEnvironment();
  // Both pools, always: the picker's whole job is to compare crowds, and a
  // count that only appears after you switch cannot help you decide to. On a
  // single-vault network both hooks take the same SWR key, so it stays one
  // request.
  const dual = vaultsSupported(networkId);
  const openPool = useSingleTokenActivity(token?.symbol ?? "", dual ? "open" : undefined);
  const verifiedPool = useSingleTokenActivity(token?.symbol ?? "", dual ? "verified" : undefined);
  const { activity, isLoading, error } = vaultId === "verified" ? verifiedPool : openPool;
  const { availableNotes, isLoading: notesLoading } = useTokenNotes(token?.shieldedSymbol ?? "");
  // One clock for the page: rendering Date.now() directly would differ between
  // the server pass and hydration.
  const now = useNow();

  if (!token || !token.enabled) {
    notFound();
  }

  const chainHref = (href: string) => hrefWithChain(href, networkId);
  const deposits = activity?.deposits ?? [];
  const depositsKnown = !isLoading && !error && activity != null;
  const timesKnown = deposits.some((d) => d.blockTime > 0);
  // Whole-pool counts, not the (possibly capped) amount list — the picker is
  // comparing crowd sizes and a cap would understate the bigger pool.
  // A token missing from a pool that loaded cleanly has zero deposits there —
  // rendering that as "unknown" hides the very fact the picker exists to show.
  const poolCount = (p: typeof openPool) =>
    p.activity ? p.activity.depositCount : p.isLoading || p.error ? null : 0;
  const poolCounts: Record<VaultId, number | null> = {
    open: poolCount(openPool),
    verified: poolCount(verifiedPool),
  };
  const vaultLabel = vaultId === "verified" ? "Verified" : "Open";
  const largestNote = availableNotes.reduce(
    (max: number | null, n) => (max == null || Number(n.amount) > max ? Number(n.amount) : max),
    null,
  );

  return (
    <main className="min-h-screen bg-background">
      <SiteHeader />

      <div className="mx-auto max-w-[980px] px-6 pb-24 pt-28 sm:px-8">
        <Link
          href={chainHref("/")}
          prefetch={false}
          className="inline-flex items-center gap-1.5 text-[13px] text-gray transition-colors hover:text-foreground"
        >
          <ArrowLeft className="h-3.5 w-3.5" />
          Back
        </Link>

        <header className="mt-4 flex flex-wrap items-center justify-between gap-x-6 gap-y-5">
          <div className="flex items-center gap-4">
            <img src={token.logo} alt="" className="h-11 w-11 rounded-full" />
            <div>
              <h1 className="section-title m-0 text-[30px] leading-tight">{token.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 font-mono text-[12px] text-gray">
                <span>{token.symbol}</span>
                <span>·</span>
                <span>{vaultLabel} pool</span>
                <span>·</span>
                <span>{networkId.toUpperCase()}</span>
              </div>
            </div>
          </div>

          {dual && (
            <PoolPicker
              networkId={networkId}
              active={vaultId}
              href={(v) => hrefWithVault(chainHref(`/pool/${params.token}`), v)}
              counts={poolCounts}
            />
          )}
        </header>

        <div className="mt-6 border-t border-gray/15" />
        <p className="m-0 mt-6 max-w-[74ch] text-[13.5px] leading-relaxed text-gray">
          Everything outside your own position is public chain data for the {vaultLabel} pool alone
          — the other pool has its own tree, and its depositors do not hide you.
          {dual && " The number on each pill is that pool's deposit count in this token."} Nothing
          you hold is sent anywhere to produce this page.
        </p>

        <div className="mt-10 flex flex-col gap-12">
          <YourPosition
            token={token}
            notes={availableNotes}
            notesLoading={notesLoading}
            deposits={deposits}
            depositsKnown={depositsKnown}
            timesKnown={timesKnown}
            vaultHref={chainHref("/vault")}
            now={now}
          />

          <Section
            title="This pool, in public"
            subtitle="Size is a stock, arrivals are a flow. A large pool that stopped growing stops adding cover to anything already deposited into it."
          >
            {isLoading ? (
              <div className="h-[104px] animate-pulse rounded-[18px] bg-gray/[0.06]" />
            ) : error || !activity ? (
              <p className="m-0 text-[13.5px] text-gray">Pool activity is unavailable right now.</p>
            ) : (
              <>
                {/* One ruled strip, not four floating boxes: these are four
                    readings off the same instrument. The gap draws the rules. */}
                <div className="grid grid-cols-2 gap-px overflow-hidden rounded-[18px] border border-gray/15 bg-gray/15 lg:grid-cols-4">
                  <Metric
                    label={`${token.symbol} deposits in`}
                    value={activity.depositCount.toLocaleString()}
                  />
                  {/* ponytail: no withdrawal timing — the indexer returns a count
                      but no block times for nullifier events, so the other half
                      of timing cover ("does anyone else withdraw around now?")
                      cannot be drawn. Surface block_time on nullifier_events to
                      add it. */}
                  <Metric
                    label="Withdrawals out"
                    value={activity.withdrawCount.toLocaleString()}
                    hint="Which deposit each one spent is not knowable — that is the point of the pool."
                  />
                  <Metric
                    label="Joined in the last 7 days"
                    value={
                      timesKnown && now != null
                        ? countDepositsSince(deposits, now - 7 * DAY_MS).toLocaleString()
                        : "—"
                    }
                    hint="New deposits are the only thing that grows the crowd around yours."
                  />
                  <Metric
                    label="Shielded now"
                    value={formatTokenAmount(Number(activity.totalShielded), token)}
                  />
                </div>

                {/* Two readings of one pool, side by side: who else is your size,
                    and whether anyone new is arriving. Stacked, comparing them
                    cost a scroll. */}
                <div className="mt-4 grid gap-px overflow-hidden rounded-[18px] border border-gray/15 bg-gray/15 lg:grid-cols-2">
                  <div className="min-w-0 bg-muted p-5 sm:p-6">
                    <h3 className="m-0 mb-5 text-[14px] font-semibold">Deposit sizes</h3>
                    <Distribution
                      deposits={deposits}
                      token={token}
                      markAmount={largestNote}
                      truncated={activity.depositsTruncated}
                    />
                  </div>
                  <div className="min-w-0 bg-muted p-5 sm:p-6">
                    <h3 className="m-0 mb-5 text-[14px] font-semibold">Deposit arrivals</h3>
                    <Arrivals deposits={deposits} now={now} />
                  </div>
                </div>
              </>
            )}
          </Section>

          <Section
            title="What actually gives you away"
            subtitle="Ranked by how often it is the thing that breaks anonymity. Pool size is not first."
          >
            {/* A ranked list, so it is built as one — the rule and the rank carry
                the order. Boxing each entry made four cards inside a card and
                implied four separate objects rather than a sequence. */}
            <ol className="m-0 flex list-none flex-col p-0">
              {LEAKS.map(([lead, rest], i) => (
                <li
                  key={lead}
                  className="flex items-baseline gap-4 border-t border-gray/15 py-3.5 first:border-t-0 first:pt-0"
                >
                  <span className="font-mono text-[12px] tabular-nums text-gray">
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <p className="m-0 max-w-[74ch] text-[13.5px] leading-relaxed text-gray">
                    <span className="font-semibold text-foreground">{lead}</span> {rest}
                  </p>
                </li>
              ))}
            </ol>

            <p className="m-0 mt-6 max-w-[74ch] text-[12.5px] leading-relaxed text-gray">
              On what these counts mean: cryptographically your note hides among every commitment in
              the tree, not just this token&apos;s. The page counts per token because that is what an
              observer actually works with — deposits are public with their token and amount
              attached, so matching starts there.
            </p>
          </Section>
        </div>
      </div>

      <SiteFooter />
    </main>
  );
}
