"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { SLIDES, SlideBody, pad } from "@/components/deck/slides";

/**
 * The deck as a 16:9 flip-through, for pages that host it rather than are it.
 * Same slide objects as /pitch — no iframe, so the site keeps its blanket
 * frame-ancestors 'none' and the slides inherit the page's own styles.
 */
export function DeckEmbed() {
  const ref = useRef<HTMLDivElement>(null);
  const [i, setI] = useState(0);
  const last = SLIDES.length - 1;

  const go = useCallback(
    (n: number) => {
      const el = ref.current;
      if (!el) return;
      const clamped = Math.min(Math.max(n, 0), last);
      el.scrollTo({ left: clamped * el.clientWidth, behavior: "smooth" });
    },
    [last],
  );

  return (
    // 16:9 is the deck's ratio, but on a phone it leaves a 200px-tall window
    // that turns every slide into four swipes. Give mobile a taller box.
    <div className="relative aspect-[4/5] w-full overflow-hidden rounded-[16px] border border-gray/15 bg-card/50 sm:aspect-video">
      <div
        ref={ref}
        tabIndex={0}
        role="region"
        aria-label="UTXOpia pitch deck"
        onScroll={(e) => {
          const el = e.currentTarget;
          setI(Math.round(el.scrollLeft / el.clientWidth));
        }}
        onKeyDown={(e) => {
          if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
          e.preventDefault();
          go(i + (e.key === "ArrowLeft" ? -1 : 1));
        }}
        className="flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden outline-none [scrollbar-width:none] focus-visible:ring-1 focus-visible:ring-privacy/40 [&::-webkit-scrollbar]:hidden"
      >
        {SLIDES.map((slide) => (
          // px-5 and no more: the @container inside must clear the 576px that
          // three-column slides need, and the box is only ~624px at 1440.
          <div
            key={slide.n}
            className="flex h-full w-full shrink-0 snap-start overflow-y-auto px-5 pb-14 pt-6"
          >
            <div className="m-auto w-full">
              <SlideBody slide={slide} />
            </div>
          </div>
        ))}
      </div>

      {/* Controls */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between gap-3 px-4 pb-3">
        <span className="rounded-full border border-gray/15 bg-background/85 px-2 py-1 font-mono text-[10px] text-gray backdrop-blur-md">
          <span className="text-foreground">{pad(i + 1)}</span>
          <span className="text-gray/40"> / {pad(SLIDES.length)}</span>
        </span>

        <div className="pointer-events-auto flex items-center gap-1.5 rounded-full border border-gray/15 bg-background/85 px-2.5 py-2 backdrop-blur-md">
          {SLIDES.map((slide, idx) => (
            <button
              key={slide.n}
              onClick={() => go(idx)}
              aria-label={`Slide ${idx + 1}: ${slide.label}`}
              aria-current={i === idx}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "w-4 bg-privacy" : "w-1.5 bg-gray/30 hover:bg-gray/60"
              }`}
            />
          ))}
        </div>

        <div className="pointer-events-auto flex items-center gap-1">
          <button
            onClick={() => go(i - 1)}
            disabled={i === 0}
            aria-label="Previous slide"
            className="rounded-full border border-gray/15 bg-background/70 p-1.5 text-gray backdrop-blur-md transition-colors hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            onClick={() => go(i + 1)}
            disabled={i === last}
            aria-label="Next slide"
            className="rounded-full border border-gray/15 bg-background/70 p-1.5 text-gray backdrop-blur-md transition-colors hover:text-foreground disabled:opacity-30"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
          <Link
            href={`/pitch#${i + 1}`}
            aria-label="Open the deck full screen"
            className="rounded-full border border-gray/15 bg-background/70 p-1.5 text-gray backdrop-blur-md transition-colors hover:text-foreground"
          >
            <Maximize2 className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
