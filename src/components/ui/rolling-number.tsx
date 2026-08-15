"use client";

import { useEffect, useRef, useState } from "react";
import { useReducedMotion } from "framer-motion";

const COLUMN = ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9"];

/** Cell height. >1 so overflow-hidden never clips a glyph's ascender. */
const CELL = "1.2em";

interface RollingNumberProps {
  value: number;
  /** Formats the number before it is split into digits, e.g. currency. */
  format?: (value: number) => string;
  className?: string;
  /** Flash green or red for 600ms in the direction of the change. */
  tint?: boolean;
}

/**
 * Odometer-style number: each digit is a 0–9 column translated into place, so a
 * changing value rolls instead of snapping. Columns move right-to-left, which is
 * what makes it read as counting rather than as a slot machine.
 *
 * Plain CSS transforms on purpose — a spring per digit would cost a React render
 * per frame per digit.
 */
export function RollingNumber({ value, format, className = "", tint = false }: RollingNumberProps) {
  const text = format ? format(value) : value.toLocaleString();
  const reduced = useReducedMotion();
  const [mounted, setMounted] = useState(false);
  const [direction, setDirection] = useState<"up" | "down" | null>(null);
  const previous = useRef(value);

  useEffect(() => setMounted(true), []);

  useEffect(() => {
    if (previous.current === value) return;
    const next = value > previous.current ? "up" : "down";
    previous.current = value;
    if (!tint) return;
    setDirection(next);
    const timer = setTimeout(() => setDirection(null), 600);
    return () => clearTimeout(timer);
  }, [value, tint]);

  // The server and the reduced-motion path both render the settled text — the
  // same string the rolling version lands on, so hydration matches and the first
  // paint is never a zero.
  if (!mounted || reduced) {
    return <span className={`tabular-nums ${className}`}>{text}</span>;
  }

  const chars = text.split("");
  // Digits closer to the right move first and fastest.
  const fromRight: number[] = new Array(chars.length).fill(0);
  for (let i = chars.length - 1, seen = 0; i >= 0; i--) {
    fromRight[i] = seen;
    if (/\d/.test(chars[i])) seen++;
  }

  const tintClass =
    direction === "up" ? "text-success" : direction === "down" ? "text-error" : "";

  return (
    <span className={`inline-flex tabular-nums transition-colors duration-300 ${tintClass} ${className}`}>
      <span className="sr-only" aria-live="polite">
        {text}
      </span>
      <span aria-hidden="true" className="inline-flex">
        {chars.map((char, i) => {
          if (!/\d/.test(char)) {
            return (
              <span key={i} className="leading-[1.2]" style={{ height: CELL }}>
                {char}
              </span>
            );
          }
          return (
            <span key={i} className="inline-block overflow-hidden" style={{ height: CELL }}>
              <span
                className="flex flex-col ease-[cubic-bezier(0.22,1,0.36,1)] motion-safe:transition-transform"
                style={{
                  transform: `translateY(-${Number(char) * 10}%)`,
                  transitionDuration: `${420 + fromRight[i] * 60}ms`,
                  transitionDelay: `${fromRight[i] * 40}ms`,
                }}
              >
                {COLUMN.map((digit) => (
                  <span key={digit} className="leading-[1.2]" style={{ height: CELL }}>
                    {digit}
                  </span>
                ))}
              </span>
            </span>
          );
        })}
      </span>
    </span>
  );
}
