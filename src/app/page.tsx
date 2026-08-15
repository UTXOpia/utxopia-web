"use client";

import React from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowRight, ChevronRight, Github, Rocket, Send, ShieldCheck } from "lucide-react";
import { usePoolStats } from "@/hooks/use-pool-stats";
import { useTokenPrices } from "@/hooks/use-token-prices";
import { getTokenBySymbol, tvlToUsd } from "@/lib/supported-tokens";
import { useExplorer } from "@/hooks/use-explorer";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter, isHybridNetwork } from "@/lib/chain-registry";
import { hrefWithChain } from "@/lib/network-config";
import repoFacts from "@/lib/repo-facts.json";

const GITHUB_URL = "https://github.com/UTXOpia";

/* ── Hero: live pool composition ─────────────────────────────────────────── */

interface Holding {
  symbol: string;
  name: string;
  logo: string;
  amount: number;
  usd: number | null;
  /** Fraction of total TVL, 0–1. Drives the bar behind each row. */
  share: number;
}

function fmtAmount(n: number) {
  return n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 4 });
}

function fmtUsd(n: number) {
  return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function PoolCard({
  holdings,
  tvlUsd,
  loading,
  vaultHref,
  sendHref,
}: {
  holdings: Holding[];
  tvlUsd: number;
  loading: boolean;
  vaultHref: string;
  sendHref: string;
}) {
  return (
    <div className="relative overflow-hidden rounded-[20px] border border-gray/20 bg-gradient-to-b from-card to-muted p-5 shadow-[0_24px_70px_rgba(0,0,0,0.5)] motion-safe:animate-[utx-drift_7s_ease-in-out_infinite]">
      {/* Slow highlight passing over the card — reads as "still running". */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 skew-x-12 bg-gradient-to-r from-transparent via-white/[0.04] to-transparent motion-safe:animate-[utx-sweep_7s_ease-in-out_infinite]"
      />

      <div className="mb-4 flex items-center gap-2.5 text-[13px] font-semibold text-gray-light">
        <span className="relative flex h-1.5 w-1.5">
          <span className="absolute inline-flex h-full w-full rounded-full bg-success opacity-75 motion-safe:animate-ping" />
          <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-success" />
        </span>
        Shielded pool
      </div>

      <div className="relative mb-3 rounded-[14px] border border-gray/15 bg-background p-5">
        <div className="mb-2 text-xs text-gray">Total value shielded</div>
        {loading ? (
          <span className="block h-9 w-40 animate-pulse rounded-lg bg-gray/10" />
        ) : (
          <AnimatedCounter
            value={tvlUsd}
            format={fmtUsd}
            className="block font-display text-[38px] font-semibold leading-none tracking-tight"
          />
        )}
      </div>

      {/* Caps at ~3 rows so the card keeps its height however many assets land. */}
      <div className="relative mb-3.5">
        <div className="scrollbar-thin flex max-h-[180px] flex-col gap-2 overflow-y-auto pr-1">
          {loading ? (
            [0, 1].map((i) => (
              <div key={i} className="h-[52px] shrink-0 animate-pulse rounded-xl bg-gray/[0.06]" />
            ))
          ) : holdings.length === 0 ? (
            <div className="rounded-xl border border-dashed border-gray/20 bg-muted px-3.5 py-4 text-center text-[13px] text-gray">
              Nothing shielded yet. Be the first commitment in the tree.
            </div>
          ) : (
            holdings.map((h, i) => (
              <motion.div
                key={h.symbol}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.45, delay: 0.15 + i * 0.1, ease: [0.22, 1, 0.36, 1] }}
                className="shrink-0"
              >
                <Link
                  href={vaultHref}
                  prefetch={false}
                  className="group relative flex items-center gap-3 overflow-hidden rounded-xl border border-gray/15 bg-muted px-3.5 py-3 transition-colors hover:border-privacy/40"
                >
                  {/* Share of pool, so the list reads as composition not just a list. */}
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 bg-privacy/[0.07] transition-[width,background-color] duration-700 ease-out group-hover:bg-privacy/[0.14]"
                    style={{ width: `${h.share * 100}%` }}
                  />
                  <img src={h.logo} alt="" className="relative h-[26px] w-[26px] rounded-full" />
                  <div className="relative">
                    <div className="text-sm font-semibold">{h.symbol}</div>
                    <div className="text-[11.5px] text-gray">{h.name}</div>
                  </div>
                  <div className="flex-1" />
                  <div className="relative text-right">
                    <div className="font-mono text-[13px]">{fmtAmount(h.amount)}</div>
                    <div className="text-[11.5px] text-gray">
                      {h.usd == null ? "—" : fmtUsd(h.usd)}
                    </div>
                  </div>
                  <ChevronRight className="relative -mr-1 h-3.5 w-3.5 shrink-0 text-gray opacity-0 transition-opacity group-hover:opacity-100" />
                </Link>
              </motion.div>
            ))
          )}
        </div>
        {holdings.length > 3 && (
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-muted to-transparent"
          />
        )}
      </div>

      <div className="relative grid grid-cols-2 gap-2.5">
        <Link href={vaultHref} prefetch={false} className="btn-privacy text-center">
          Shield
        </Link>
        <Link href={sendHref} prefetch={false} className="btn-tertiary text-center">
          Send privately
        </Link>
      </div>
    </div>
  );
}

/* ── How it works ────────────────────────────────────────────────────────── */

function StepCard({
  step,
  stepColor,
  title,
  children,
  body,
}: {
  step: string;
  stepColor: string;
  title: string;
  children: React.ReactNode;
  body: string;
}) {
  return (
    <div className="flex h-full flex-col gap-5 rounded-[18px] border border-gray/15 bg-muted/50 p-7">
      <div className="flex items-center gap-3">
        <span
          className={`rounded-md px-2 py-0.5 font-mono text-[11px] font-bold text-background ${stepColor}`}
        >
          {step}
        </span>
        <span className="text-base font-semibold">{title}</span>
      </div>
      <div className="flex h-[150px] flex-col justify-center gap-3.5 overflow-hidden rounded-xl border border-gray/15 bg-background p-4.5">
        {children}
      </div>
      <p className="m-0 text-pretty text-[14.5px] leading-relaxed text-gray">{body}</p>
    </div>
  );
}

function DepositViz() {
  return (
    <>
      <div className="flex items-center gap-3">
        <img src="/tokens/btc.png" alt="" className="h-8 w-8 rounded-full" />
        <div className="relative h-0.5 flex-1 overflow-hidden bg-gradient-to-r from-btc to-privacy">
          <span className="absolute inset-y-0 left-0 w-[30%] bg-white/75 motion-safe:animate-[utx-sweep_2.6s_linear_infinite]" />
        </div>
        <div className="flex h-8 w-8 items-center justify-center rounded-[9px] border border-privacy/35 bg-privacy/10 text-privacy">
          <ShieldCheck className="h-4 w-4" />
        </div>
      </div>
      <div className="font-mono text-[11px] leading-[1.7] text-gray">
        <div>amount → Poseidon(v, r, pk)</div>
        <div className="text-privacy">commitment 0x9e41…a7d2</div>
      </div>
    </>
  );
}

function AnonymitySetViz({ commitments }: { commitments: number | null }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2.5">
      <div className="h-3.5 w-[30px] rounded bg-privacy/90" />
      <div className="flex gap-5">
        <div className="h-3 w-[26px] rounded bg-privacy/55" />
        <div className="h-3 w-[26px] rounded bg-privacy/55" />
      </div>
      <div className="flex gap-2.5">
        <div className="h-2.5 w-4 rounded-sm bg-gray/35" />
        <div className="h-2.5 w-4 rounded-sm bg-gray/35" />
        <div className="h-2.5 w-4 rounded-sm bg-btc shadow-[0_0_12px_rgba(247,147,26,0.6)]" />
        <div className="h-2.5 w-4 rounded-sm bg-gray/35" />
      </div>
      <div className="font-mono text-[11px] text-gray">
        {commitments == null ? "your note, one of many" : `your note, one of ${commitments}`}
      </div>
    </div>
  );
}

function SpendViz() {
  const rows = [
    { k: "nullifier", v: "0x31c8…4b0f", cls: "text-foreground" },
    { k: "proof", v: "valid", cls: "text-success" },
    { k: "recipient", v: "stealth address", cls: "text-privacy" },
  ];
  return (
    <div className="flex flex-col gap-2.5">
      {rows.map((r, i) => (
        <React.Fragment key={r.k}>
          {i > 0 && <div className="h-px bg-gray/15" />}
          <div className="flex items-center justify-between font-mono text-[11px]">
            <span className="text-gray">{r.k}</span>
            <span className={r.cls}>{r.v}</span>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── Verify ──────────────────────────────────────────────────────────────── */

/** Trailing slice of the weekly commit history, dropping pre-repo empty weeks. */
const ACTIVITY = (() => {
  const a = repoFacts.commitActivity;
  const first = a.findIndex((n) => n > 0);
  return first === -1 ? a : a.slice(first);
})();
const ACTIVITY_MAX = Math.max(1, ...ACTIVITY);

const SHOWN_ARTIFACTS = ["joinsplit_2x2.zkey", "joinsplit_1x1.zkey", "joinsplit_2x2.vkey.json"]
  .map((name) => repoFacts.artifacts.find((a) => a.path.endsWith(`/${name}`)))
  .filter((a): a is { path: string; sha256: string } => Boolean(a));

function shortHash(sha: string) {
  return `${sha.slice(0, 4)}…${sha.slice(-4)}`;
}

/* ── Page ────────────────────────────────────────────────────────────────── */

export default function Home() {
  // The landing page has no pool scope, so its TVL is every pool's value.
  const { stats, isLoading: isLoadingStats, error: statsError } = usePoolStats(undefined, "all");
  const prices = useTokenPrices();
  const {
    transactions,
    isLoading: isLoadingTransactions,
    error: transactionsError,
  } = useExplorer();
  const { networkId, config } = useChainEnvironment();
  const chain = getChainAdapter(config);
  const chainName = chain.displayName;
  const chainHref = (href: string) => hrefWithChain(href, networkId);
  const faucetHref = chainHref(isHybridNetwork(networkId) ? "/faucet" : "/docs");

  const txCount = transactions.length;
  const tvlUsd = stats?.tokenTVL?.length ? tvlToUsd(stats.tokenTVL, prices) : 0;
  const tvlDisplay = tvlUsd > 0 ? fmtUsd(tvlUsd) : "No TVL";

  const holdings: Holding[] = (stats?.tokenTVL ?? [])
    .map((t) => {
      const token = getTokenBySymbol(t.symbol);
      const amount = Number(t.totalShielded) / 10 ** t.decimals;
      let price = token ? (prices[token.priceKey] ?? null) : null;
      if (price == null && (token?.priceKey === "usdc" || token?.priceKey === "usdt")) price = 1;
      return {
        symbol: t.symbol,
        name: token?.name ?? t.symbol,
        logo: token?.logo ?? `/tokens/${t.symbol.toLowerCase()}.png`,
        amount,
        usd: price == null ? null : amount * price,
      };
    })
    .filter((h) => h.amount > 0)
    .sort((a, b) => (b.usd ?? 0) - (a.usd ?? 0))
    .map((h) => ({ ...h, share: tvlUsd > 0 && h.usd ? h.usd / tvlUsd : 0 }));

  const statsUnavailable = Boolean(statsError) || !stats;

  return (
    <main className="min-h-screen bg-background overflow-x-hidden">
      {/* ═══════════════ ALPHA BANNER ═══════════════ */}
      <div className="fixed top-0 left-0 z-[60] flex w-full flex-wrap items-center justify-center gap-2.5 border-b border-gray/20 bg-muted px-4 py-2 text-[12.5px] font-medium text-gray-light">
        <span className="h-1.5 w-1.5 rounded-full bg-warning animate-pulse" />
        <span className="font-mono tracking-[0.08em] text-warning">PUBLIC ALPHA</span>
        <span className="hidden text-gray sm:inline">
          Devnet and regtest only. Do not send mainnet funds.
        </span>
        <span className="text-gray sm:hidden">Testnet only</span>
        <Link href="#alpha" className="border-b border-gray/40 text-foreground hover:border-foreground">
          What that means
        </Link>
      </div>

      <SiteHeader top="top-14" />

      <div className="relative z-10">
        {/* ═══════════════ HERO ═══════════════ */}
        <section className="relative overflow-hidden px-6 pb-16 pt-36 sm:px-8 lg:pt-40">
          <div className="pointer-events-none absolute -top-[280px] left-1/2 h-[600px] w-[900px] -translate-x-1/2 bg-[radial-gradient(50%_50%_at_50%_50%,rgba(166,116,255,0.20),transparent_70%)]" />
          <div className="pointer-events-none absolute -right-[120px] top-[60px] h-[520px] w-[520px] bg-[radial-gradient(50%_50%_at_50%_50%,rgba(247,147,26,0.10),transparent_70%)]" />

          <div className="relative mx-auto grid max-w-[1180px] items-center gap-12 lg:grid-cols-[1.05fr_0.95fr] lg:gap-16">
            <ScrollReveal>
              <div className="flex flex-col items-start gap-6">
                <div className="inline-flex items-center gap-2 rounded-full border border-privacy/25 bg-privacy/[0.08] py-1.5 pl-2 pr-3 font-mono text-xs font-semibold tracking-[0.06em] text-privacy">
                  <span className="h-1.5 w-1.5 rounded-full bg-privacy" />
                  ZERO-KNOWLEDGE · {chainName.toUpperCase()}
                </div>

                <h1 className="hero-title m-0 text-balance">
                  Private.
                  <br />
                  <span className="text-privacy">Audit&#8209;ready.</span>
                  <br />
                  {chainName}.
                </h1>

                <p className="m-0 max-w-[480px] text-pretty text-lg leading-relaxed text-gray-light">
                  One private vault for Bitcoin and supported {chainName} assets. Privacy by default,
                  auditable on demand.
                </p>

                <div className="flex flex-wrap gap-3">
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                    <Link
                      href={chainHref("/vault")}
                      prefetch={false}
                      className="btn-privacy btn-shimmer inline-flex"
                    >
                      <Rocket className="h-4 w-4" />
                      Open private vault
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                    <Link href="#how" className="btn-tertiary inline-flex">
                      See how it works
                    </Link>
                  </motion.div>
                </div>

                <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pt-1 text-[13px] text-gray">
                  {[
                    { label: "Non‑custodial", cls: "bg-success/15 border-success/35" },
                    { label: "Proofs generated in your browser", cls: "bg-privacy/15 border-privacy/35" },
                    { label: "Open source", cls: "bg-btc/15 border-btc/35" },
                  ].map((t) => (
                    <span key={t.label} className="flex items-center gap-2">
                      <span className={`h-3.5 w-3.5 rounded border ${t.cls}`} />
                      {t.label}
                    </span>
                  ))}
                </div>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.15}>
              <PoolCard
                holdings={holdings}
                tvlUsd={tvlUsd}
                loading={isLoadingStats}
                vaultHref={chainHref("/vault")}
                sendHref={chainHref("/send")}
              />
            </ScrollReveal>
          </div>
        </section>

        {/* ═══════════════ LIVE STATS ═══════════════ */}
        <section className="px-6 pb-20 sm:px-8">
          <ScrollReveal>
            <div className="mx-auto grid max-w-[1180px] grid-cols-1 items-center gap-8 rounded-[18px] border border-gray/15 bg-muted/50 px-8 py-6 md:grid-cols-2 lg:grid-cols-[1fr_auto_auto_auto]">
              <div className="flex flex-col gap-1.5">
                <div className="flex items-center gap-2 font-mono text-[11px] tracking-[0.08em] text-gray">
                  <span className="h-1.5 w-1.5 rounded-full bg-success animate-pulse" />
                  LIVE · {networkId.toUpperCase()}
                </div>
                <div className="text-[12.5px] text-gray">
                  Read from the indexer, updated continuously
                </div>
              </div>

              <Metric
                label="Transactions"
                value={txCount}
                loading={isLoadingTransactions}
                unavailable={Boolean(transactionsError)}
              />
              <Metric
                label="Commitments in tree"
                value={stats?.totalCommitments ?? 0}
                loading={isLoadingStats}
                unavailable={statsUnavailable}
                color="text-privacy"
              />
              <Metric
                label="Total value locked"
                value={tvlDisplay}
                loading={isLoadingStats}
                unavailable={statsUnavailable}
              />
            </div>
          </ScrollReveal>
        </section>

        {/* ═══════════════ HOW IT WORKS ═══════════════ */}
        <section id="how" className="scroll-mt-32 px-6 pb-24 sm:px-8">
          <div className="mx-auto max-w-[1180px]">
            <ScrollReveal>
              <div className="mb-12 max-w-[620px]">
                <div className="mb-3.5 font-mono text-[11.5px] tracking-[0.1em] text-privacy">
                  HOW IT WORKS
                </div>
                <h2 className="section-title m-0 mb-3.5 text-balance text-3xl leading-[1.08] md:text-[42px]">
                  Nothing is hidden from you. Everything is hidden from everyone else.
                </h2>
                <p className="m-0 text-pretty text-[17px] leading-relaxed text-gray">
                  Three steps, all verifiable on chain. Your keys and your proofs never leave your
                  device.
                </p>
              </div>
            </ScrollReveal>

            <div className="grid gap-5 md:grid-cols-3">
              <ScrollReveal delay={0.05}>
                <StepCard
                  step="01"
                  stepColor="bg-btc"
                  title="Deposit"
                  body="Send BTC or shield a Solana asset. The chain records a commitment, not your amount or your address."
                >
                  <DepositViz />
                </StepCard>
              </ScrollReveal>
              <ScrollReveal delay={0.1}>
                <StepCard
                  step="02"
                  stepColor="bg-privacy"
                  title="Join the set"
                  body="Your commitment is inserted into a Merkle tree alongside every other one. Anonymity comes from the crowd, and the crowd is public."
                >
                  <AnonymitySetViz
                    commitments={statsUnavailable ? null : (stats?.totalCommitments ?? null)}
                  />
                </StepCard>
              </ScrollReveal>
              <ScrollReveal delay={0.15}>
                <StepCard
                  step="03"
                  stepColor="bg-success"
                  title="Spend"
                  body="A zero-knowledge proof shows the note was yours and unspent, without revealing which one. Share a viewing key when you need to prove it."
                >
                  <SpendViz />
                </StepCard>
              </ScrollReveal>
            </div>
          </div>
        </section>

        {/* ═══════════════ ASSETS + ALPHA HONESTY ═══════════════ */}
        <section className="px-6 pb-24 sm:px-8">
          <div className="mx-auto grid max-w-[1180px] items-stretch gap-5 lg:grid-cols-2">
            <ScrollReveal>
              <div className="flex h-full flex-col rounded-[18px] border border-gray/15 bg-muted/50 p-8">
                <h3 className="section-title m-0 mb-2 text-2xl">Supported assets</h3>
                <p className="m-0 mb-6 text-[14.5px] text-gray">
                  Deposit Bitcoin or shield supported {chainName} assets into your private vault.
                </p>
                <div className="grid flex-1 auto-rows-fr gap-2.5 sm:grid-cols-2">
                  {[
                    { name: "BTC", label: "Bitcoin", live: true, logo: "/tokens/btc.png" },
                    { name: chain.nativeToken, label: chainName, live: true, logo: `/tokens/${chain.query}.png` },
                    { name: "USDC", label: "USD Coin", live: true, logo: "/tokens/usdc.png" },
                    { name: "USDT", label: "Tether", live: true, logo: "/tokens/usdt.png" },
                    { name: "ETH", label: "Soon", live: false, logo: "/tokens/eth.png" },
                    { name: "ZEC", label: "Soon", live: false, logo: "/tokens/zec.png" },
                  ].map((t) => (
                    <div
                      key={t.name}
                      className={`flex items-center gap-3 rounded-xl bg-background px-3.5 py-3 ${
                        t.live ? "border border-gray/15" : "border border-dashed border-gray/20 opacity-55"
                      }`}
                    >
                      <img src={t.logo} alt="" className="h-[26px] w-[26px] rounded-full" />
                      <div>
                        <div className="text-sm font-semibold">{t.name}</div>
                        <div className="text-[11.5px] text-gray">{t.label}</div>
                      </div>
                      <div className="flex-1" />
                      {t.live && <span className="h-1.5 w-1.5 rounded-full bg-success" />}
                    </div>
                  ))}
                </div>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.1}>
              <div
                id="alpha"
                className="h-full scroll-mt-32 rounded-[18px] border border-warning/20 bg-gradient-to-b from-[#1c1610] to-muted/50 p-8"
              >
                <div className="mb-3.5 flex items-center gap-2.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-warning" />
                  <span className="font-mono text-[11.5px] tracking-[0.09em] text-warning">
                    WHERE WE ACTUALLY ARE
                  </span>
                </div>
                <h3 className="section-title m-0 mb-2.5 text-2xl">Public alpha, on testnet</h3>
                <p className="m-0 mb-6 text-pretty text-[14.5px] leading-relaxed text-gray-light">
                  We would rather you trust us for the right reasons. Here is the honest state of the
                  protocol.
                </p>
                <div className="flex flex-col gap-3">
                  {[
                    "Devnet and regtest only. Mainnet is not enabled and no real funds are at risk.",
                    "Circuits are unaudited. An external review is the gate for mainnet, not a milestone after it.",
                    "The anonymity set is small in alpha. With few users, privacy is limited by arithmetic, not intent.",
                  ].map((line, i) => (
                    <div
                      key={i}
                      className="flex items-start gap-3 rounded-xl border border-gray/15 bg-background p-3.5"
                    >
                      <span className="pt-0.5 font-mono text-[11px] text-warning">
                        {String(i + 1).padStart(2, "0")}
                      </span>
                      <p className="m-0 text-sm leading-relaxed text-gray-light">{line}</p>
                    </div>
                  ))}
                </div>
                <div className="mt-5 flex flex-wrap items-center gap-3.5">
                  <Link
                    href={faucetHref}
                    prefetch={false}
                    className="rounded-[11px] border border-warning/35 bg-warning/[0.12] px-4 py-2.5 text-[13.5px] font-semibold text-warning transition-colors hover:bg-warning/20"
                  >
                    Get testnet funds
                  </Link>
                  <Link
                    href={chainHref("/docs")}
                    prefetch={false}
                    className="text-[13.5px] font-semibold text-gray-light hover:text-foreground"
                  >
                    Read the roadmap to mainnet
                  </Link>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* ═══════════════ VERIFY ═══════════════ */}
        <section id="verify" className="scroll-mt-32 px-6 pb-24 sm:px-8">
          <div className="mx-auto max-w-[1180px]">
            <ScrollReveal>
              <div className="mb-11 max-w-[620px]">
                <div className="mb-3.5 font-mono text-[11.5px] tracking-[0.1em] text-privacy">
                  VERIFY, DO NOT TRUST
                </div>
                <h2 className="section-title m-0 mb-3.5 text-balance text-3xl leading-[1.08] md:text-[42px]">
                  Every claim on this page is checkable.
                </h2>
                <p className="m-0 text-pretty text-[17px] leading-relaxed text-gray">
                  The client, the circuits and the programs are public. Build them yourself and
                  compare the hashes.
                </p>
              </div>
            </ScrollReveal>

            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-[1.15fr_1fr_1fr]">
              <ScrollReveal delay={0.05}>
                <div className="flex h-full flex-col gap-4 rounded-[18px] border border-gray/15 bg-muted/50 p-6">
                  <span className="text-base font-semibold">Source</span>
                  <div className="flex flex-col gap-2">
                    {repoFacts.repos.map((r) => (
                      <a
                        key={r.key}
                        href={r.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 rounded-[10px] border border-gray/15 bg-background px-3 py-2.5 transition-colors hover:border-privacy/35"
                      >
                        <span className="truncate font-mono text-[11.5px] text-gray-light">
                          {r.name.split("/")[1]}
                        </span>
                        <span className="flex-1" />
                        <span className="shrink-0 font-mono text-[11px] text-gray">{r.head}</span>
                      </a>
                    ))}
                  </div>
                  <div className="flex h-11 items-end gap-[3px]" aria-hidden="true">
                    {ACTIVITY.map((n, i) => (
                      <div
                        key={i}
                        className="flex-1 rounded-sm bg-privacy/75"
                        style={{ height: `${Math.max(4, (n / ACTIVITY_MAX) * 100)}%` }}
                      />
                    ))}
                  </div>
                  <div className="text-[12.5px] text-gray">
                    Commit activity across all three, last {ACTIVITY.length} weeks
                  </div>
                  <div className="flex flex-wrap gap-2.5">
                    {["MIT", "TypeScript · Rust · Circom"].map((chip) => (
                      <span
                        key={chip}
                        className="rounded-[7px] border border-gray/15 bg-background px-2.5 py-1.5 font-mono text-[11.5px] text-gray-light"
                      >
                        {chip}
                      </span>
                    ))}
                  </div>
                  <div className="flex-1" />
                  <a
                    href={GITHUB_URL}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 text-[13.5px] font-semibold text-privacy hover:text-foreground"
                  >
                    <Github className="h-3.5 w-3.5" />
                    Browse the source →
                  </a>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.1}>
                <div className="flex h-full flex-col gap-4 rounded-[18px] border border-gray/15 bg-muted/50 p-6">
                  <span className="text-base font-semibold">Circuit artifacts</span>
                  <p className="m-0 text-sm leading-relaxed text-gray">
                    {repoFacts.circuitCount} Groth16 circuits served to your browser, pinned by
                    hash.
                  </p>
                  <div className="flex flex-col gap-2.5 font-mono text-[11.5px]">
                    {SHOWN_ARTIFACTS.map((a) => (
                      <div
                        key={a.path}
                        className="flex justify-between gap-3 rounded-[10px] border border-gray/15 bg-background px-3 py-2.5"
                      >
                        <span className="truncate text-gray">{a.path.split("/").pop()}</span>
                        <span className="shrink-0">{shortHash(a.sha256)}</span>
                      </div>
                    ))}
                  </div>
                  <div className="flex-1" />
                  <Link
                    href={chainHref("/verify-proof")}
                    prefetch={false}
                    className="text-[13.5px] font-semibold text-privacy hover:text-foreground"
                  >
                    Reproduce the build →
                  </Link>
                </div>
              </ScrollReveal>

              <ScrollReveal delay={0.15}>
                <div className="flex h-full flex-col gap-4 rounded-[18px] border border-gray/15 bg-muted/50 p-6">
                  <span className="text-base font-semibold">Runs on your machine</span>
                  <p className="m-0 text-sm leading-relaxed text-gray">
                    Nothing that could deanonymise you leaves the browser.
                  </p>
                  <div className="flex flex-col gap-2.5 text-[13.5px]">
                    {[
                      "Keys derived locally",
                      "Proofs built in a web worker",
                      "No account, no email, no tracking",
                      "Relayer never sees your notes",
                    ].map((line) => (
                      <div key={line} className="flex items-center gap-2.5 text-gray-light">
                        <span className="font-mono text-success">✓</span>
                        {line}
                      </div>
                    ))}
                  </div>
                  <div className="flex-1" />
                  <Link
                    href={chainHref("/docs#security")}
                    prefetch={false}
                    className="text-[13.5px] font-semibold text-privacy hover:text-foreground"
                  >
                    Read the threat model →
                  </Link>
                </div>
              </ScrollReveal>
            </div>
          </div>
        </section>

        {/* ═══════════════ CTA ═══════════════ */}
        <section className="px-6 pb-24 sm:px-8">
          <ScrollReveal variant="scaleIn">
            <div className="relative mx-auto max-w-[1180px] overflow-hidden rounded-[22px] border border-gray/20 bg-[linear-gradient(140deg,#1b1526_0%,#131318_55%,#1a1410_100%)] px-8 py-16 md:px-12 md:py-[72px]">
              <div className="pointer-events-none absolute -bottom-[220px] left-1/2 h-[420px] w-[700px] -translate-x-1/2 bg-[radial-gradient(50%_50%_at_50%_50%,rgba(166,116,255,0.18),transparent_70%)]" />
              <div className="relative flex flex-col items-center gap-5 text-center">
                <h2 className="section-title m-0 max-w-[640px] text-balance text-3xl leading-[1.06] md:text-[44px]">
                  Try it with testnet funds. Judge it for yourself.
                </h2>
                <p className="m-0 max-w-[520px] text-pretty text-[17px] leading-relaxed text-gray-light">
                  The faucet gives you devnet SOL and regtest BTC. Shield an asset, send it
                  privately, then verify the proof in the explorer.
                </p>
                <div className="flex flex-wrap justify-center gap-3">
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                    <Link
                      href={chainHref("/vault")}
                      prefetch={false}
                      className="btn-privacy btn-shimmer inline-flex"
                    >
                      <Send className="h-4 w-4" />
                      Open private vault
                    </Link>
                  </motion.div>
                  <motion.div whileHover={{ scale: 1.04 }} whileTap={{ scale: 0.97 }}>
                    <Link href={faucetHref} prefetch={false} className="btn-tertiary inline-flex">
                      Get testnet funds
                    </Link>
                  </motion.div>
                </div>
              </div>
            </div>
          </ScrollReveal>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}

/* ── Stats bar metric ────────────────────────────────────────────────────── */

function Metric({
  label,
  value,
  loading,
  unavailable,
  color = "text-foreground",
}: {
  label: string;
  value: number | string;
  loading: boolean;
  unavailable?: boolean;
  color?: string;
}) {
  return (
    <div className="flex flex-col gap-1 lg:border-l lg:border-gray/15 lg:pl-9">
      <div className="flex h-9 items-center">
        {loading ? (
          <span
            className="block h-7 w-20 animate-pulse rounded-md bg-gray/10"
            role="status"
            aria-label={`Loading ${label.toLowerCase()}`}
          />
        ) : unavailable ? (
          <span className="font-display text-[32px] font-semibold text-gray/35" title="Temporarily unavailable">
            —
          </span>
        ) : typeof value === "number" ? (
          <AnimatedCounter
            value={value}
            decimals={0}
            className={`font-display text-[32px] font-semibold tracking-tight ${color}`}
          />
        ) : (
          <span className={`font-display text-[32px] font-semibold tracking-tight ${color}`}>
            {value}
          </span>
        )}
      </div>
      <span className="text-[12.5px] text-gray">{label}</span>
    </div>
  );
}
