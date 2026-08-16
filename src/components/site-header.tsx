"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { Droplets, Menu, Wallet, X, Settings as SettingsIcon } from "lucide-react";
import { motion, AnimatePresence } from "framer-motion";
import { AdvancedModeBadge } from "@/components/ui/advanced-mode-badge";
import { isHybridNetwork } from "@/lib/chain-registry";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";

/** `top` shifts the pill down on pages that render a banner above it. */
export function SiteHeader({ top = "top-4" }: { top?: "top-4" | "top-14" } = {}) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const { networkId: network } = useChainEnvironment();
  const isHybrid = isHybridNetwork(network);
  const chainHref = (href: string) => hrefWithChain(href, network);

  return (
    <>
      <nav className={`fixed ${top} left-0 w-full z-50 flex justify-center px-4`}>
        <motion.div
          // `transition-all` animated height and width as well, so every reflow
          // of the pill's contents ran as a layout animation.
          className="nav-pill px-2 py-2 sm:px-4 flex items-center transition-colors duration-300"
          initial={{ y: -20, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
        >
          {/* Logo — capybara mark, transparent, floats naturally */}
          <Link href={chainHref("/")} className="flex items-center gap-2.5 group shrink-0">
            <motion.div
              className="relative w-10 h-10 flex items-center justify-center transition-all duration-300 group-hover:drop-shadow-[0_0_8px_rgba(208,173,92,0.4)]"
              whileHover={{ scale: 1.08 }}
              transition={{ type: "spring", stiffness: 400, damping: 20 }}
            >
              <Image
                src="/brand/logo-transparent-128.png"
                alt="UTXOpia"
                width={40}
                height={40}
                priority
                className="h-full w-full object-contain"
              />
            </motion.div>
            <span className="text-sm font-semibold tracking-tight text-foreground group-hover:text-privacy transition-colors">
              UTXOpia
            </span>
            {/* 11px floor: this is a status label people are meant to read, and
                letterspaced 9px caps fail on small screens. */}
            <span className="ml-0.5 px-1.5 py-0.5 rounded-full border border-privacy/30 bg-privacy/10 text-[11px] font-mono uppercase tracking-[0.15em] text-privacy/90 leading-none select-none">
              Alpha
            </span>
          </Link>

          {/* Desktop links */}
          <div className="hidden md:flex items-center justify-center gap-5 flex-1 mx-5">
            {[
              { href: "/explorer", label: "Explorer" },
              { href: "/docs", label: "Docs" },
            ].map(({ href, label }) => (
              <motion.div key={href} whileHover={{ y: -1 }}>
                <Link
                  href={chainHref(href)}
                  prefetch={false}
                  className="text-xs font-medium text-gray hover:text-foreground transition-all py-3 px-2"
                >
                  {label}
                </Link>
              </motion.div>
            ))}
          </div>

          {/* Desktop CTA */}
          <div className="hidden md:flex items-center gap-2 shrink-0">
            <AdvancedModeBadge />
            {isHybrid && (
              <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
                <Link
                  href={chainHref("/faucet")}
                  prefetch={false}
                  className="inline-flex items-center gap-1.5 text-xs font-medium border border-warning/10 px-3.5 py-2.5 rounded-full transition-all text-warning/75 bg-warning/[0.06] hover:bg-warning/10 hover:border-warning/20 hover:text-warning"
                >
                  <Droplets className="w-3 h-3" />
                  Faucet
                </Link>
              </motion.div>
            )}
            <Link
              href={chainHref("/settings")}
              prefetch={false}
              aria-label="Settings"
              className="p-2 rounded-full text-gray hover:text-foreground hover:bg-muted/50 transition-colors"
            >
              <SettingsIcon className="w-3.5 h-3.5" />
            </Link>
            <motion.div whileHover={{ scale: 1.05 }} whileTap={{ scale: 0.95 }}>
              <Link
                href={chainHref("/vault")}
                prefetch={false}
                className="inline-flex items-center gap-1.5 text-xs font-semibold px-4 py-2.5 rounded-full transition-all bg-foreground text-background hover:bg-white hover:shadow-[0_0_15px_rgba(255,255,255,0.12)]"
              >
                <Wallet className="w-3 h-3" />
                Private vault
              </Link>
            </motion.div>
          </div>

          {/* Mobile hamburger */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            aria-label={mobileOpen ? "Close site navigation" : "Open site navigation"}
            aria-expanded={mobileOpen}
            className="md:hidden ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-gray hover:text-foreground transition-colors"
          >
            {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </button>
        </motion.div>
      </nav>

      {/* Mobile menu dropdown */}
      <AnimatePresence>
        {mobileOpen && (
          <>
            {/* Backdrop */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-40 bg-black/50 backdrop-blur-sm md:hidden"
              onClick={() => setMobileOpen(false)}
            />
            {/* Menu panel */}
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              transition={{ duration: 0.2 }}
              className={`fixed ${top === "top-14" ? "top-28" : "top-16"} left-4 right-4 z-50 md:hidden rounded-2xl border border-gray/10 bg-background/95 backdrop-blur-xl p-4 shadow-xl`}
            >
              <div className="space-y-1">
                {[
                  { href: "/vault", label: "Private vault" },
                  ...(isHybrid ? [{ href: "/faucet", label: "Faucet" }] : []),
                  { href: "/explorer", label: "Explorer" },
                  { href: "/docs", label: "Docs" },
                  { href: "/settings", label: "Settings" },
                ].map(({ href, label }) => (
                  <Link
                    key={href}
                    href={chainHref(href)}
                    onClick={() => setMobileOpen(false)}
                    className="flex items-center px-4 py-3 rounded-xl text-sm font-medium text-gray-light hover:text-foreground hover:bg-muted/50 transition-colors"
                  >
                    {label}
                  </Link>
                ))}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
