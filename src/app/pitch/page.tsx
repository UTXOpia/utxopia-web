"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { ChevronDown } from "lucide-react";
import { SLIDES, SlideBody, pad } from "@/components/deck/slides";

/**
 * The deck at full size: one screen per slide, scroll-snapped, addressable at
 * /pitch#1 … #10 so a single slide can be linked into a conversation.
 *
 * Sections are min-h-dvh rather than h-dvh — on a short phone slide 9 is taller
 * than the viewport, and a fixed height silently clipped it off both ends.
 */
export default function PitchPage() {
  const scrollerRef = useRef<HTMLDivElement>(null);
  const [current, setCurrent] = useState(1);
  const total = SLIDES.length;

  // Where we are heading, which runs ahead of `current` during a smooth scroll.
  // Keying off state instead makes two fast presses advance only one slide.
  const targetRef = useRef(1);
  const settleAtRef = useRef(0);

  const goTo = useCallback(
    (n: number) => {
      const clamped = Math.min(Math.max(n, 1), total);
      targetRef.current = clamped;
      settleAtRef.current = performance.now() + 800;
      document.getElementById(String(clamped))?.scrollIntoView({ behavior: "smooth" });
    },
    [total],
  );

  // Track the slide filling the viewport so the counter and rail stay honest.
  useEffect(() => {
    const root = scrollerRef.current;
    if (!root) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const hit = entries.find((e) => e.isIntersecting);
        if (!hit) return;
        const n = Number((hit.target as HTMLElement).dataset.slide);
        setCurrent(n);
        // Only free scrolling may move the target; a mid-animation sync would
        // undo a queued keypress.
        if (performance.now() > settleAtRef.current) targetRef.current = n;
      },
      { root, threshold: 0.55 },
    );
    root.querySelectorAll("[data-slide]").forEach((el) => obs.observe(el));
    return () => obs.disconnect();
  }, []);

  useEffect(() => {
    const keys = [
      "ArrowRight",
      "ArrowDown",
      "PageDown",
      "ArrowLeft",
      "ArrowUp",
      "PageUp",
      "Home",
      "End",
    ];
    const onKey = (e: KeyboardEvent) => {
      if (!keys.includes(e.key)) return;
      e.preventDefault();
      if (e.key === "Home") return goTo(1);
      if (e.key === "End") return goTo(total);
      const back = e.key === "ArrowLeft" || e.key === "ArrowUp" || e.key === "PageUp";
      goTo(targetRef.current + (back ? -1 : 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, total]);

  return (
    <div className="relative bg-background">
      <Link
        href="/careers"
        className="fixed left-5 top-5 z-30 flex items-center gap-2 rounded-full border border-gray/15 bg-background/70 px-3 py-1.5 backdrop-blur-md transition-colors hover:border-gray/30 sm:left-8 sm:top-8"
      >
        <Image src="/brand/logo-transparent-128.png" alt="" width={16} height={16} />
        <span className="text-[10px] font-semibold tracking-tight text-foreground">UTXOpia</span>
      </Link>

      <div className="fixed bottom-5 left-5 z-30 rounded-full border border-gray/15 bg-background/80 px-2.5 py-1 font-mono text-[10px] text-gray backdrop-blur-md sm:bottom-8 sm:left-8">
        <span className="text-foreground">{pad(current)}</span>
        <span className="text-gray/40"> / {pad(total)}</span>
      </div>

      <nav
        aria-label="Slides"
        className="fixed right-6 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 sm:flex"
      >
        {SLIDES.map((slide) => (
          <button
            key={slide.n}
            onClick={() => goTo(slide.n)}
            aria-label={`Slide ${slide.n}: ${slide.label}`}
            aria-current={current === slide.n}
            className="group flex items-center justify-end gap-2"
          >
            <span
              className={`text-[9px] uppercase tracking-wider transition-opacity ${
                current === slide.n
                  ? "text-gray opacity-100"
                  : "text-gray/60 opacity-0 group-hover:opacity-100"
              }`}
            >
              {slide.label}
            </span>
            <span
              className={`h-1.5 w-1.5 rounded-full transition-all ${
                current === slide.n ? "scale-125 bg-privacy" : "bg-gray/30 group-hover:bg-gray/60"
              }`}
            />
          </button>
        ))}
      </nav>

      {current < total && (
        <button
          onClick={() => goTo(current + 1)}
          aria-label="Next slide"
          className="fixed bottom-5 left-1/2 z-30 -translate-x-1/2 rounded-full border border-gray/15 bg-background/70 p-2 text-gray backdrop-blur-md transition-colors hover:text-foreground sm:bottom-8"
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      )}

      <div
        ref={scrollerRef}
        className="h-dvh snap-y snap-mandatory overflow-y-scroll scroll-smooth"
      >
        {SLIDES.map((slide) => (
          <section
            key={slide.n}
            id={String(slide.n)}
            data-slide={slide.n}
            className="flex min-h-dvh snap-start flex-col justify-center px-6 py-24 sm:px-16 sm:py-28 lg:px-24"
          >
            <SlideBody slide={slide} />
          </section>
        ))}
      </div>
    </div>
  );
}
