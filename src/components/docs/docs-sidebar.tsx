"use client";

import { useState, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ListTree, X } from "lucide-react";

export interface NavItem {
  id: string;
  label: string;
}

export const NAV_ITEMS: NavItem[] = [
  { id: "using-utxopia", label: "Quick Guide" },
  { id: "feature-reference", label: "All Features" },
  { id: "pools", label: "Open & Verified" },
  { id: "terminology", label: "Key Terms" },
  { id: "overview", label: "Privacy Model" },
  { id: "protocol-flow", label: "How It Works" },
  { id: "cryptography", label: "Cryptography & Keys" },
  { id: "disclosure", label: "Audit & Disclosure" },
  { id: "security", label: "Security" },
];

function getAllSectionIds(): string[] {
  return NAV_ITEMS.map((item) => item.id);
}

export function useAllSectionIds() {
  return getAllSectionIds();
}

/* ── Shared nav list (used by both desktop sidebar and mobile drawer) ── */

interface NavListProps {
  activeSection: string;
  onNavigate: (id: string) => void;
}

function NavList({ activeSection, onNavigate }: NavListProps) {
  return (
    <nav className="space-y-1">
      {NAV_ITEMS.map((item) => (
        <NavButton
          key={item.id}
          id={item.id}
          label={item.label}
          isActive={activeSection === item.id}
          onNavigate={onNavigate}
        />
      ))}
    </nav>
  );
}

function NavButton({
  id,
  label,
  isActive,
  onNavigate,
}: {
  id: string;
  label: string;
  isActive: boolean;
  onNavigate: (id: string) => void;
}) {
  return (
    <button
      onClick={() => onNavigate(id)}
      aria-current={isActive ? "location" : undefined}
      className={`min-h-11 w-full rounded-lg border px-3 py-2 text-left text-[13px] font-medium transition-colors ${
        isActive
          ? "border-privacy/20 bg-privacy/8 text-foreground"
          : "border-transparent text-gray hover:border-gray/10 hover:bg-muted/30 hover:text-foreground"
      }`}
    >
      {label}
    </button>
  );
}

/* ── Desktop sidebar ── */

interface DocsSidebarProps {
  activeSection: string;
}

function revealSection(id: string) {
  const el = document.getElementById(id);
  if (!el) return;

  const disclosure =
    el instanceof HTMLDetailsElement ? el : el.closest("details");
  if (disclosure) disclosure.open = true;

  window.requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: "smooth" });
    window.history.replaceState(null, "", `#${id}`);
  });
}

export function DocsSidebar({ activeSection }: DocsSidebarProps) {
  const handleClick = useCallback((id: string) => {
    revealSection(id);
  }, []);

  return <NavList activeSection={activeSection} onNavigate={handleClick} />;
}

/* ── Mobile sidebar bar + drawer ── */

interface MobileSidebarProps {
  activeSection: string;
}

export function MobileSidebarBar({ activeSection }: MobileSidebarProps) {
  const [open, setOpen] = useState(false);

  const handleClick = (id: string) => {
    revealSection(id);
    setOpen(false);
  };

  return (
    <>
      {/* Mobile menu button — aligned with nav pill */}
      {!open && (
        <div className="lg:hidden fixed top-4 left-0.5 z-50">
          <button
            onClick={() => setOpen(true)}
            aria-label="Open guide navigation"
            title="Guide navigation"
            className="flex h-11 w-11 items-center justify-center rounded-xl border border-gray/10 bg-background/80 backdrop-blur-md hover:bg-muted/30 transition-colors shadow-sm"
          >
            <ListTree className="h-5 w-5 text-gray" />
          </button>
        </div>
      )}

      {/* Drawer overlay + panel */}
      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm lg:hidden"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ x: "-100%" }}
              animate={{ x: 0 }}
              exit={{ x: "-100%" }}
              transition={{ type: "spring", damping: 25, stiffness: 300 }}
              className="fixed top-0 left-0 bottom-0 z-[60] w-[280px] max-w-[85vw] bg-background border-r border-gray/10 overflow-y-auto lg:hidden"
            >
              <div className="flex items-center justify-between px-4 py-4 border-b border-gray/10">
                <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-gray/40">
                  Product Guide
                </span>
                <button
                  onClick={() => setOpen(false)}
                  aria-label="Close guide navigation"
                  className="flex h-11 w-11 items-center justify-center rounded-lg hover:bg-muted/30 transition-colors"
                >
                  <X className="h-5 w-5 text-gray" />
                </button>
              </div>
              <div className="p-4">
                <NavList
                  activeSection={activeSection}
                  onNavigate={handleClick}
                />
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
