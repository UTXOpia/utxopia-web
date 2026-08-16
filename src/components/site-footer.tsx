"use client";

import Link from "next/link";
import Image from "next/image";
import { motion } from "framer-motion";
import { Github } from "lucide-react";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter } from "@/lib/chain-registry";
import { hrefWithChain } from "@/lib/network-config";

export function SiteFooter() {
  const { networkId, config } = useChainEnvironment();
  const chainName = getChainAdapter(config).displayName;

  // Opaque, not translucent. Nothing scrolls behind the last element on the
  // page, so the blur bought no effect — it only made text contrast depend on
  // whatever happened to be underneath, which is how the tagline landed below
  // the 4.5:1 bar.
  return (
    <footer className="w-full border-t border-gray/10 bg-background py-8 sm:py-12 px-6 relative overflow-hidden">
      {/* Subtle top gradient line */}
      <div className="absolute top-0 left-0 w-full h-px bg-gradient-to-r from-transparent via-privacy/20 to-transparent" />

      <motion.div
        className="max-w-6xl mx-auto flex flex-col md:flex-row justify-between items-center gap-6"
        initial={{ opacity: 0, y: 10 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
      >
        <Link href={hrefWithChain("/", networkId)} className="flex items-center gap-2 group">
          <div className="relative w-6 h-6 flex items-center justify-center transition-transform group-hover:scale-110">
            <Image
              src="/brand/logo-transparent-128.png"
              alt="UTXOpia"
              width={24}
              height={24}
              className="h-full w-full object-contain"
            />
          </div>
          <span className="text-sm font-medium tracking-tight text-foreground group-hover:text-privacy transition-colors">
            UTXOpia
          </span>
        </Link>

        {/* A marketing line, so it yields first: on a phone the footer's job is
            navigation, and this was taking the most prominent slot to say the
            least useful thing. */}
        <div className="hidden sm:block text-caption text-gray-light">
          Private transfers for supported assets on {chainName}
        </div>

        {/* Wraps and centres rather than staying a rigid row. At 390px the old
            fixed row could not fit its contents, so it broke a phrase across
            two lines and left the icon aligned against nothing. */}
        <div className="flex flex-wrap items-center justify-center gap-x-4">
          <Link
            href={hrefWithChain("/architecture", networkId)}
            className="inline-flex min-h-11 items-center px-1 text-caption text-gray hover:text-foreground transition-colors"
          >
            Architecture
          </Link>
          <Link
            href={hrefWithChain("/careers", networkId)}
            className="inline-flex min-h-11 items-center px-1 text-caption text-gray hover:text-foreground transition-colors"
          >
            Careers
          </Link>
          {/* min-h-11 on all three: the marks are small but the targets are not,
              and 18px-tall text links are not tappable. */}
          <a
            href="https://github.com/UTXOpia"
            target="_blank"
            rel="noopener noreferrer"
            aria-label="GitHub"
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-full text-gray hover:text-foreground hover:bg-muted/50 transition-colors"
          >
            <Github className="w-4 h-4" />
          </a>
        </div>
      </motion.div>
    </footer>
  );
}
