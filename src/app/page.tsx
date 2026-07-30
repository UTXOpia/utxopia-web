"use client";

import React, { memo } from "react";
import Link from "next/link";
import { motion } from "framer-motion";
import { Shield, Zap, Lock, ArrowRight, EyeOff, ShieldCheck, ChevronRight, Layers, Rocket } from "lucide-react";
import { usePoolStats } from "@/hooks/use-pool-stats";
import { useTokenPrices } from "@/hooks/use-token-prices";
import { tvlToUsd } from "@/lib/supported-tokens";
import { useExplorer } from "@/hooks/use-explorer";
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { GradientBorderCard } from "@/components/ui/gradient-border-card";
import { AnimatedCounter } from "@/components/ui/animated-counter";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter } from "@/lib/chain-registry";
import { hrefWithChain } from "@/lib/network-config";
import { cn } from "@/lib/utils";

/* ── Feature visualizations ── */

const PrivacyViz = () => (
  <div className="flex-1 w-full rounded-xl border border-privacy/10 bg-muted/20 flex flex-col items-center justify-center gap-3 p-6 overflow-hidden relative">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03),transparent)]" />
    <div className="w-full space-y-2.5 z-10">
      {[
        { fromStart: "0xa3", fromMid: "f7e2", fromEnd: "c21b", toStart: "0x91", toMid: "d2b8", toEnd: "e8f4", amt: "0.0042", delay: 0 },
        { fromStart: "0xb8", fromMid: "e1a3", fromEnd: "9a7c", toStart: "0x4d", toMid: "6fc7", toEnd: "2b1e", amt: "0.1500", delay: 100 },
        { fromStart: "0xf2", fromMid: "c9d1", fromEnd: "5d3a", toStart: "0x7e", toMid: "8ba2", toEnd: "a4c6", amt: "0.0831", delay: 200 },
      ].map((row, i) => (
        <div
          key={i}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-background/40 border border-privacy/10"
        >
          <span className="text-[10px] font-mono text-privacy/40">
            {row.fromStart}<span className="inline-block blur-[4px] text-privacy/80">{row.fromMid}</span>{row.fromEnd}
          </span>
          <span className="text-[8px] text-privacy/25">→</span>
          <span className="text-[10px] font-mono text-privacy/40">
            {row.toStart}<span className="inline-block blur-[4px] text-privacy/80">{row.toMid}</span>{row.toEnd}
          </span>
          <span className="text-[10px] font-mono text-privacy/80 blur-[4px]">{row.amt}</span>
        </div>
      ))}
    </div>
    <div className="flex items-center gap-2 z-10 mt-1">
      <div className="w-1.5 h-1.5 rounded-full bg-privacy/60 animate-pulse" />
      <span className="text-[9px] font-mono text-privacy/40">addresses & amounts hidden by ZK proof</span>
    </div>
  </div>
);

const BackedViz = () => (
  <div className="flex-1 w-full rounded-xl border border-privacy/10 bg-muted/20 flex flex-col items-center justify-center gap-4 p-6 relative overflow-hidden">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(255,255,255,0.03),transparent)]" />
    <div className="flex items-center gap-6 z-10">
      <div className="flex flex-col items-center gap-2">
        <div className="w-14 h-14 rounded-2xl border border-privacy/25 bg-background/40 flex items-center justify-center">
          <Layers className="w-7 h-7 text-privacy/70" />
        </div>
        <span className="text-[10px] font-mono text-privacy/50">Supported Assets</span>
      </div>
      <div className="flex flex-col items-center gap-1">
        <div className="flex items-center gap-1">
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-2 h-0.5 rounded-full bg-privacy/40" />
          ))}
          <Lock className="w-3.5 h-3.5 text-privacy/50" />
          {[0, 1, 2].map((i) => (
            <div key={i} className="w-2 h-0.5 rounded-full bg-privacy/40" />
          ))}
        </div>
        <span className="text-[8px] text-privacy/30">shield</span>
      </div>
      <div className="flex flex-col items-center gap-2">
        <div className="w-14 h-14 rounded-2xl border border-privacy/25 bg-background/40 flex items-center justify-center">
          <Shield className="w-8 h-8 text-privacy/70" aria-hidden="true" />
        </div>
        <span className="text-[10px] font-mono text-privacy/50">Shielded</span>
      </div>
    </div>
    <div className="flex items-center gap-2 z-10">
      <span className="text-[9px] font-mono text-privacy/40">any SPL token → private commitment</span>
    </div>
  </div>
);

const SpeedViz = () => (
  <div className="flex-1 w-full rounded-xl border border-sol/10 bg-muted/20 flex flex-col items-center justify-center gap-4 p-6 relative overflow-hidden">
    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_center,rgba(153,69,255,0.04),transparent)]" />
    <div className="w-full space-y-3 z-10">
      {[
        { label: "Confirmation", value: "~400ms", pct: 95 },
        { label: "Proof Gen", value: "~2.1s", pct: 70 },
        { label: "Settlement", value: "instant", pct: 100 },
      ].map((metric, i) => (
        <div key={metric.label} className="space-y-1.5">
          <div className="flex items-center justify-between">
            <span className="text-[10px] font-mono text-sol/40">{metric.label}</span>
            <span className="text-[10px] font-mono text-sol/50">{metric.value}</span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-background/40 overflow-hidden">
            <div
              className="h-full rounded-full bg-sol/40"
              style={{ width: `0%`, transition: `width 2.5s cubic-bezier(0.16, 1, 0.3, 1) ${i * 400 + 300}ms` }}
              ref={(el) => {
                if (el) {
                  const obs = new IntersectionObserver(([e]) => {
                    if (e.isIntersecting) {
                      requestAnimationFrame(() => { el.style.width = `${metric.pct}%`; });
                      obs.disconnect();
                    }
                  }, { threshold: 0.2 });
                  obs.observe(el);
                }
              }}
            />
          </div>
        </div>
      ))}
    </div>
    <div className="flex items-center gap-2 z-10 mt-1">
      <Zap className="w-3 h-3 text-sol/50" />
      <span className="text-[9px] font-mono text-sol/40">high-throughput settlement</span>
    </div>
  </div>
);

const ComplianceViz = () => (
  <div className="flex-1 w-full rounded-xl border border-cyan/10 bg-muted/20 flex flex-col items-center justify-center gap-3 p-6 relative overflow-hidden">
    <div className="absolute inset-0">
      <div className="absolute top-0 left-0 w-full h-full bg-gradient-to-r from-transparent via-cyan/5 to-transparent animate-[sweep_2s_ease-in-out_infinite]" />
    </div>
    <div className="w-full space-y-2.5 z-10">
      {[
        { label: "Origin Attested", status: "on-chain", checked: true },
        { label: "View Key Delegated", status: "scoped", checked: true },
        { label: "Audit Trail", status: "on-demand", checked: false },
      ].map((item) => (
        <div
          key={item.label}
          className="flex items-center justify-between px-3 py-2 rounded-lg bg-background/40 border border-cyan/10"
        >
          <div className="flex items-center gap-2">
            <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${
              item.checked
                ? "border-cyan/40 bg-cyan/15"
                : "border-gray/20"
            }`}>
              {item.checked && (
                <span className="text-[8px] text-cyan/70">✓</span>
              )}
            </div>
            <span className="text-[10px] font-mono text-gray/45">{item.label}</span>
          </div>
          <span className={`text-[8px] font-mono ${
            item.checked ? "text-cyan/40" : "text-gray/25"
          }`}>{item.status}</span>
        </div>
      ))}
    </div>
    <div className="flex items-center gap-2 z-10 mt-1">
      <ShieldCheck className="w-3 h-3 text-cyan/50" />
      <span className="text-[9px] font-mono text-cyan/40">selective disclosure toolkit</span>
    </div>
  </div>
);

const FeatureCard = memo(function FeatureCard({
  icon: Icon, title, description, iconColor, hoverGlow, step, visualization: Viz,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  iconColor: string;
  hoverGlow: string;
  step: string;
  visualization: React.ComponentType;
}) {
  return (
    <GradientBorderCard hoverGlow={hoverGlow} step={step} className="h-full">
      <div className="flex flex-col h-full">
        <div className="flex items-center gap-3 mb-1.5">
          <div className="p-2 rounded-lg border border-gray/10 bg-muted/30 shrink-0">
            <Icon className={`w-4 h-4 ${iconColor}`} />
          </div>
          <h3 className="text-lg font-semibold text-foreground">{title}</h3>
        </div>
        <p className="text-sm text-gray-light font-light mb-4 leading-relaxed">{description}</p>
        <Viz />
      </div>
    </GradientBorderCard>
  );
});
FeatureCard.displayName = "FeatureCard";

const FEATURE_CARDS = [
  { icon: EyeOff, title: "Private Transfers", description: "Proofs verify transfers without revealing sender, recipient, or amount.", iconColor: "text-privacy", hoverGlow: "rgba(255, 255, 255, 0.08)", step: "01", visualization: PrivacyViz },
  { icon: Layers, title: "Shielded Assets", description: "Bitcoin and supported tokens become private commitments.", iconColor: "text-privacy", hoverGlow: "rgba(255, 255, 255, 0.08)", step: "02", visualization: BackedViz },
  { icon: Zap, title: "Guided Flows", description: "Add funds, send privately, cash out, or withdraw BTC with clear transaction progress.", iconColor: "text-sol", hoverGlow: "rgba(153, 69, 255, 0.12)", step: "03", visualization: SpeedViz },
  { icon: ShieldCheck, title: "Viewing Keys", description: "Share read-only activity with an auditor when needed.", iconColor: "text-cyan", hoverGlow: "rgba(0, 255, 255, 0.08)", step: "04", visualization: ComplianceViz },
];

function HomeMetric({
  label,
  value,
  loading,
  unavailable,
  color,
}: {
  label: string;
  value: number | string;
  loading: boolean;
  unavailable?: boolean;
  color: string;
}) {
  return (
    <div className="text-center min-w-0 px-1 first:border-l-0 border-l border-gray/15">
      <div className="h-7 flex items-center justify-center">
        {loading ? (
          <span
            className="block h-5 w-12 rounded-[6px] bg-gray/10 animate-pulse"
            aria-label={`Loading ${label.toLowerCase()}`}
            role="status"
          />
        ) : unavailable ? (
          <span
            className="text-xl sm:text-2xl font-semibold text-gray/35"
            aria-label={`${label} unavailable`}
            title="Temporarily unavailable"
          >
            —
          </span>
        ) : typeof value === "number" ? (
          <AnimatedCounter
            value={value}
            decimals={0}
            className={`text-xl sm:text-2xl font-semibold tracking-normal ${color}`}
          />
        ) : (
          <span className={`text-xl sm:text-2xl font-semibold tracking-normal whitespace-nowrap ${color}`}>
            {value}
          </span>
        )}
      </div>
      <div className="text-xs text-gray">{label}</div>
    </div>
  );
}

function FeatureCarousel() {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
      {FEATURE_CARDS.map((card) => (
        <FeatureCard key={card.step} {...card} />
      ))}
    </div>
  );
}

/* ── Main Page ── */

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
  const nativeToken = {
    name: chain.nativeToken,
    label: chain.displayName,
    status: "Live",
    logo: `/tokens/${chain.query}.png`,
  };
  const chainHref = (href: string) => hrefWithChain(href, networkId);
  const txCount = transactions.length;
  const tvlDisplay = (() => {
    if (!stats?.tokenTVL?.length) return "No TVL";
    const usd = tvlToUsd(stats.tokenTVL, prices);
    return usd > 0
      ? `$${usd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : "No TVL";
  })();

  return (
    <main className="min-h-screen bg-background overflow-x-hidden">
      <SiteHeader />

      <div className="relative z-10">
        {/* ═══════════════ HERO ═══════════════ */}
        <section className="min-h-[70vh] flex flex-col items-center justify-center px-4 pt-28 pb-12 relative">
          <div className="max-w-4xl mx-auto text-center relative z-10">
            <ScrollReveal delay={0.05}>
              <div className="mb-5 inline-flex items-center gap-2 px-3 py-1 rounded-full border border-privacy/25 bg-privacy/5 backdrop-blur-sm">
                <span className="w-1.5 h-1.5 rounded-full bg-privacy animate-pulse" />
                <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-privacy/90">
                  Public Alpha
                </span>
                <span className="text-[11px] text-gray/70">
                  testnet only
                </span>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={0.1}>
              <h1 className="hero-title text-foreground">
                Private. <span className="text-privacy">Audit-ready.</span>{" "}
                <span className="text-foreground">{chainName}.</span>
              </h1>
            </ScrollReveal>

            <ScrollReveal delay={0.15}>
              <p className="mt-6 text-base md:text-lg text-gray font-light max-w-lg mx-auto leading-relaxed">
                One private vault for Bitcoin and supported {chainName} assets. Privacy by default, auditable on demand.
              </p>
            </ScrollReveal>

            <ScrollReveal delay={0.2}>
              <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-caption text-gray">
                <div className="flex items-center gap-1.5">
                  <EyeOff className="w-4 h-4 text-privacy" />
                  <span>Private by Default</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-cyan" />
                  <span>Auditable on Demand</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <Layers className="w-4 h-4 text-sol" />
                  <span>Cross-Chain Assets</span>
                </div>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.25}>
              <div className="mt-8 flex flex-col sm:flex-row items-center justify-center gap-3">
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }}>
                  <Link
                    href={chainHref("/vault")}
                    prefetch={false}
                    className="btn-privacy btn-pill btn-shimmer inline-flex items-center gap-2 px-7 py-2.5 text-base shadow-[0_0_20px_rgba(255,255,255,0.06)] hover:shadow-[0_0_35px_rgba(255,255,255,0.12)] transition-shadow"
                  >
                    <Rocket className="w-5 h-5" />
                    Open Private Vault
                    <ArrowRight className="w-5 h-5" />
                  </Link>
                </motion.div>
                <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }}>
                  <Link
                    href={chainHref("/docs")}
                    prefetch={false}
                    className="btn-tertiary btn-pill inline-flex items-center gap-2 px-5 py-2.5 border border-gray/10 backdrop-blur-md hover:bg-muted/50 hover:border-gray/20 transition-all"
                  >
                    <Shield className="w-4 h-4" />
                    Read the Guide
                  </Link>
                </motion.div>
              </div>
            </ScrollReveal>

            <ScrollReveal delay={0.3}>
              <div className="pt-8 border-t border-gray/10 mt-8">
                <div
                  className="grid grid-cols-3 items-stretch w-full max-w-md mx-auto"
                  aria-label="Network statistics"
                >
                  <HomeMetric
                    label="Transactions"
                    value={txCount}
                    loading={isLoadingTransactions}
                    unavailable={Boolean(transactionsError)}
                    color="text-privacy"
                  />
                  <HomeMetric
                    label="Commitments"
                    value={stats?.totalCommitments ?? 0}
                    loading={isLoadingStats}
                    unavailable={Boolean(statsError) || !stats}
                    color="text-foreground"
                  />
                  <HomeMetric
                    label="Total Value Locked"
                    value={tvlDisplay}
                    loading={isLoadingStats}
                    unavailable={Boolean(statsError) || !stats}
                    color={tvlDisplay === "No TVL" ? "text-foreground/60" : "text-foreground"}
                  />
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* ═══════════════ SUPPORTED TOKENS ═══════════════ */}
        <section className="w-full py-10 px-4 sm:px-6 lg:px-8 relative">
          <div className="max-w-5xl mx-auto relative z-10">
            <ScrollReveal>
              <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between mb-8 gap-4">
                <div>
              <h2 className="section-title text-3xl md:text-4xl text-foreground mb-2">
                    Add <span className="text-privacy">Supported Assets</span>
                  </h2>
                  <p className="text-sm text-gray font-light">
                    Deposit Bitcoin or shield supported Solana assets into your private vault.
                  </p>
                </div>
                <Link href={chainHref("/vault")} prefetch={false} className="text-sm text-privacy/70 hover:text-privacy transition-colors flex items-center gap-1 shrink-0">
                  Add funds <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </div>
            </ScrollReveal>
            <ScrollReveal delay={0.1}>
              <div className="flex gap-3 overflow-x-auto pb-2">
                {[
                  { name: "BTC", label: "Bitcoin", status: "Live", logo: "/tokens/btc.png" },
                  nativeToken,
                  { name: "USDC", label: "USD Coin", status: "Live", logo: "/tokens/usdc.png" },
                  { name: "USDT", label: "Tether", status: "Live", logo: "/tokens/usdt.png" },
                  { name: "ETH", label: "Ethereum", status: "Soon", logo: "/tokens/eth.png" },
                  { name: "ZEC", label: "Zcash", status: "Soon", logo: "/tokens/zec.png" },
                ].map((token) => (
                  <div
                    key={token.name}
                    className={`flex items-center gap-3 px-4 py-3 rounded-[12px] border backdrop-blur-sm shrink-0 transition-all ${
                      token.status === "Live"
                        ? "bg-muted/30 border-gray/10 hover:border-privacy/20 hover:bg-privacy/5"
                        : "bg-muted/15 border-gray/5 opacity-50"
                    }`}
                  >
                    <span className="flex h-8 w-8 items-center justify-center rounded-full bg-background/70">
                      <img
                        src={token.logo}
                        alt={token.name}
                        className="object-contain h-8 w-8 rounded-full"
                      />
                    </span>
                    <div>
                      <p className="text-sm font-semibold text-foreground">{token.name}</p>
                      <p className="text-[10px] text-gray/50">{token.label}</p>
                    </div>
                    {token.status === "Live" && (
                      <span className="ml-1 h-1.5 w-1.5 rounded-full animate-pulse bg-privacy" />
                    )}
                  </div>
                ))}
              </div>
            </ScrollReveal>
          </div>
        </section>

        {/* ═══════════════ HOW IT WORKS ═══════════════ */}
        <section className="w-full py-14 px-4 sm:px-6 lg:px-8 relative overflow-hidden">
          <div className="absolute inset-0 bg-gradient-to-b from-transparent via-muted/5 to-transparent pointer-events-none" />

          <div className="max-w-7xl mx-auto relative z-10">
            <ScrollReveal>
              <div className="text-center mb-12">
                <h2 className="section-title text-3xl md:text-4xl text-foreground mb-3">
                  How It <span className="text-privacy">Works</span>
                </h2>
                <p className="text-sm text-gray font-light">
                  Four layers of protection for your tokens on {chainName}.
                </p>
              </div>
            </ScrollReveal>

            <FeatureCarousel />
          </div>
        </section>

        {/* ═══════════════ CTA ═══════════════ */}
        <section className="w-full py-14 px-4 sm:px-6 relative overflow-hidden">
          <div className="max-w-4xl mx-auto relative z-10">
            <ScrollReveal variant="scaleIn">
              <div className="rounded-[20px] border border-privacy/15 bg-gradient-to-br from-privacy/5 via-transparent to-purple/5 p-8 md:p-12 text-center relative overflow-hidden">
                <div className="relative z-10">
                  <h2 className="section-title text-3xl md:text-4xl text-foreground mb-3">
                    Open Your <span className="text-privacy">Private Vault</span>
                  </h2>
                <p className="text-base text-gray font-light mb-8 max-w-md mx-auto">
                    Add supported assets, send privately, and disclose activity only when you choose.
                  </p>
                  <div className="flex flex-col sm:flex-row items-center justify-center gap-4">
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }}>
                      <Link
                        href={chainHref("/vault")}
                        prefetch={false}
                        className="btn-privacy btn-pill btn-shimmer inline-flex items-center gap-2 px-7 py-3 text-base shadow-[0_0_20px_rgba(255,255,255,0.06)] hover:shadow-[0_0_35px_rgba(255,255,255,0.12)] transition-shadow"
                      >
                        <Rocket className="w-5 h-5" />
                        Open Private Vault
                        <ArrowRight className="w-5 h-5" />
                      </Link>
                    </motion.div>
                    <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.97 }}>
                      <Link
                        href={chainHref("/explorer")}
                        prefetch={false}
                        className="btn-tertiary btn-pill inline-flex items-center gap-2 px-5 py-3 border border-gray/10 backdrop-blur-md hover:bg-muted/50 hover:border-gray/20 transition-all"
                      >
                        View Explorer
                        <ChevronRight className="w-4 h-4" />
                      </Link>
                    </motion.div>
                  </div>
                </div>
              </div>
            </ScrollReveal>
          </div>
        </section>
      </div>

      <SiteFooter />
    </main>
  );
}
