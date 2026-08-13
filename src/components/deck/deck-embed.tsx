"use client";

import { useCallback, useRef, useState } from "react";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react";
import { SLIDES, SlideBody, pad } from "@/components/deck/slides";

/**
 * The deck as a flip-through, for pages that host it rather than are it. Same
 * slide objects as /pitch — no iframe, so the site keeps its blanket
 * frame-ancestors 'none' and the slides inherit the page's own styles.
 *
 * Controls sit below the frame rather than over it. Overlaid, they landed on a
 * line of body text whenever a slide was taller than the box, which is most of
 * them; outside, that can't happen at any scroll position.
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
    <div>
      {/* 16:9 is the deck's ratio, but on a phone that leaves a 200px window
          and turns every slide into four swipes. Mobile gets a taller frame. */}
      <div className="aspect-[4/5] w-full overflow-hidden rounded-[16px] border border-gray/15 bg-card/50 sm:aspect-video">
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
          className="flex h-full snap-x snap-mandatory overflow-x-auto overflow-y-hidden outline-none [scrollbar-width:none] focus-visible:ring-1 focus-visible:ring-btc/40 [&::-webkit-scrollbar]:hidden"
        >
          {/* px-5 and no more: the @container inside must clear the 512px that
              three-column slides need, and the frame is only ~624px at 1440. */}
          {SLIDES.map((slide) => (
            <div
              key={slide.n}
              className="flex h-full w-full shrink-0 snap-start overflow-y-auto px-5 py-6"
            >
              <div className="m-auto w-full">
                <SlideBody slide={slide} />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="mt-2.5 flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] text-gray">
          <span className="text-foreground">{pad(i + 1)}</span>
          <span className="text-gray/40"> / {pad(SLIDES.length)}</span>
        </span>

        <div className="flex items-center gap-1.5">
          {SLIDES.map((slide, idx) => (
            <button
              key={slide.n}
              onClick={() => go(idx)}
              aria-label={`Slide ${idx + 1}: ${slide.label}`}
              aria-current={i === idx}
              className={`h-1.5 rounded-full transition-all ${
                i === idx ? "w-4 bg-btc" : "w-1.5 bg-gray/30 hover:bg-gray/60"
              }`}
            />
          ))}
        </div>

        <div className="flex items-center gap-1">
          <button
            onClick={() => go(i - 1)}
            disabled={i === 0}
            aria-label="Previous slide"
            className="rounded-full border border-gray/15 p-1.5 text-gray transition-colors hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeft className="h-3 w-3" />
          </button>
          <button
            onClick={() => go(i + 1)}
            disabled={i === last}
            aria-label="Next slide"
            className="rounded-full border border-gray/15 p-1.5 text-gray transition-colors hover:text-foreground disabled:opacity-30"
          >
            <ChevronRight className="h-3 w-3" />
          </button>
          <Link
            href={`/pitch#${i + 1}`}
            aria-label="Open the deck full screen"
            className="rounded-full border border-gray/15 p-1.5 text-gray transition-colors hover:text-foreground"
          >
            <Maximize2 className="h-3 w-3" />
          </Link>
        </div>
      </div>
    </div>
  );
}
