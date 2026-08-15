import React from "react";
import {
  ArrowUpRight,
  Bitcoin,
  Eye,
  EyeOff,
  Fingerprint,
  Globe,
  Key,
  Landmark,
  Lock,
  Settings,
  Shield,
  ShieldCheck,
  TrendingUp,
  UserCheck,
  Users,
  Zap,
} from "lucide-react";
import type { Accent, Block, Card as CardData, IconName, Slide } from "./deck-content";
import { SLIDES, pad } from "./deck-content";
import { cn } from "@/lib/utils";

/**
 * The deck's web rendering. Content lives in deck-content.ts — this file only
 * decides how each block kind looks, and the PPTX exporter makes the same
 * decisions for print. Nothing here may depend on viewport size: sizing is done
 * with container queries so a slide reads right at 356px inside the /careers
 * embed and at 1440px on /pitch.
 */

export type { Slide };
export { SLIDES, pad };

const ICONS: Record<IconName, React.ElementType> = {
  key: Key,
  users: Users,
  eye: Eye,
  "eye-off": EyeOff,
  fingerprint: Fingerprint,
  lock: Lock,
  "shield-check": ShieldCheck,
  settings: Settings,
  zap: Zap,
  landmark: Landmark,
  globe: Globe,
  "user-check": UserCheck,
  bitcoin: Bitcoin,
  "trending-up": TrendingUp,
  shield: Shield,
};

const accentText = (a: Accent = "btc") => (a === "privacy" ? "text-privacy/80" : "text-btc/80");

const Card = ({ icon, title, body, note, accent }: CardData) => {
  const Icon = icon ? ICONS[icon] : undefined;
  return (
    <div className="rounded-[14px] border border-gray/15 bg-muted/30 p-3 @xl:p-4">
      {Icon && <Icon className={`mb-2 h-4 w-4 @xl:mb-3 ${accentText(accent)}`} />}
      <p className="text-caption font-semibold text-foreground">{title}</p>
      <p className="mt-1.5 text-caption leading-relaxed text-gray">{body}</p>
      {note && (
        <p className={cn("mt-3 text-caption", accent === "privacy" ? "text-privacy" : "text-btc")}>
          {note}
        </p>
      )}
    </div>
  );
};

// Breakpoints are sized for the narrowest place a slide renders — inside the
// embed the container is ~582px at 1440, so both column counts land at @lg
// (512px) rather than sitting a few pixels under a higher breakpoint.
const COLS = { 1: "", 2: "@lg:grid-cols-2", 3: "@lg:grid-cols-3" } as const;

function BlockView({ block }: { block: Block }) {
  switch (block.kind) {
    case "pills":
      return (
        <div className="flex flex-wrap gap-2">
          {block.items.map((t) => (
            <span
              key={t}
              className="rounded-full border border-btc/25 bg-btc/[0.07] px-3.5 py-1.5 text-caption text-btc"
            >
              {t}
            </span>
          ))}
        </div>
      );

    case "cards":
      return (
        <div className={`grid gap-2.5 @xl:gap-3 ${COLS[block.cols]}`}>
          {block.items.map((c) => (
            <Card key={c.title} {...c} />
          ))}
        </div>
      );

    case "flow":
      // Boxes are direct flex siblings so all four share the row equally; an
      // arrow nested inside the last wrapper would make that box wider.
      return (
        <div className="flex flex-col gap-2 @xl:flex-row @xl:items-stretch">
          {block.items.map((step, i, arr) => (
            <React.Fragment key={step.title}>
              <div
                className={cn(
                  "flex-1 rounded-[12px] border px-3 py-2.5",
                  step.accent === "btc"
                    ? "border-btc/40 bg-btc/[0.06]"
                    : "border-gray/15 bg-muted/30",
                )}
              >
                <p
                  className={cn(
                    "text-caption font-semibold",
                    step.accent === "btc" ? "text-btc" : "text-foreground",
                  )}
                >
                  {step.title}
                </p>
                <p className="mt-0.5 text-[10px] leading-snug text-gray">{step.body}</p>
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
      );

    case "numbered":
      return (
        <div className="space-y-2 @xl:space-y-2.5">
          {block.items.map((item, i) => (
            <div
              key={item.title}
              className="flex gap-3 rounded-[14px] border border-gray/15 bg-muted/30 p-3 @xl:gap-4 @xl:p-4"
            >
              <span className="font-mono text-caption text-btc/70">{i + 1}</span>
              <div>
                <p className="text-caption font-semibold text-foreground">{item.title}</p>
                <p className="mt-1 text-caption leading-relaxed text-gray">{item.body}</p>
              </div>
            </div>
          ))}
        </div>
      );

    case "callout":
      return (
        <p
          className={cn(
            "text-caption leading-relaxed text-gray-light",
            block.boxed &&
              (block.accent === "privacy"
                ? "rounded-[12px] border border-privacy/25 bg-privacy/[0.05] px-4 py-3"
                : "rounded-[12px] border border-btc/25 bg-btc/[0.05] px-4 py-3"),
          )}
        >
          {block.label && <span className="font-semibold text-btc">{block.label} </span>}
          {block.body}
        </p>
      );

    case "links":
      return (
        <div className="flex flex-wrap gap-x-5 gap-y-2 text-caption text-gray">
          {block.items.map((l) => (
            <a
              key={l.href}
              href={l.href}
              target={l.href.startsWith("http") ? "_blank" : undefined}
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline underline-offset-4 hover:text-foreground"
            >
              {l.label}
              {l.href.startsWith("http") && <ArrowUpRight className="h-3 w-3" />}
            </a>
          ))}
        </div>
      );
  }
}

/**
 * One slide's content. The caller owns the box; this owns everything inside it.
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

      {slide.blocks?.map((block, i) => (
        <div key={i} className="mt-5 @xl:mt-8">
          <BlockView block={block} />
        </div>
      ))}

      {slide.footnote && (
        <p className="mt-5 max-w-[70ch] text-caption leading-relaxed text-btc/90 @xl:mt-8">
          {slide.footnote}
        </p>
      )}
    </div>
  );
}
