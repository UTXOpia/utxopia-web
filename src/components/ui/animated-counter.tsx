"use client";

import { useEffect, useRef, useState } from "react";
import { motion, useInView, useSpring, useTransform } from "framer-motion";

interface AnimatedCounterProps {
  value: number;
  decimals?: number;
  duration?: number;
  className?: string;
  prefix?: string;
  suffix?: string;
  /** Overrides the default fixed-decimal rendering, e.g. for currency. */
  format?: (value: number) => string;
}

/**
 * Animated number counter that counts up when scrolled into view.
 */
export function AnimatedCounter({
  value,
  decimals = 0,
  duration = 1.5,
  className = "",
  prefix = "",
  suffix = "",
  format,
}: AnimatedCounterProps) {
  const ref = useRef<HTMLSpanElement>(null);
  const isInView = useInView(ref, { once: true, margin: "-40px" });
  const spring = useSpring(0, { duration: duration * 1000, bounce: 0 });
  const render = (v: number) => `${prefix}${format ? format(v) : v.toFixed(decimals)}${suffix}`;
  const display = useTransform(spring, render);
  const [displayValue, setDisplayValue] = useState(render(0));

  useEffect(() => {
    if (isInView) {
      spring.set(value);
    }
  }, [isInView, value, spring]);

  useEffect(() => {
    const unsubscribe = display.on("change", (v) => setDisplayValue(v));
    return unsubscribe;
  }, [display]);

  return (
    <motion.span ref={ref} className={className}>
      {displayValue}
    </motion.span>
  );
}
