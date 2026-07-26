"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { ArrowUpFromLine, ChevronRight, PlusCircle, Send } from "lucide-react";
import { cn } from "@/lib/utils";
import { hrefWithChain, type NetworkId } from "@/lib/network-config";
import { PRODUCT_COPY } from "@/lib/product-language";
import { hrefWithVault, type VaultId } from "@/lib/vault-config";

interface VaultActionsProps {
  networkId: NetworkId;
  isViewOnly: boolean;
  depositCount: number;
  vaultId: VaultId;
}

export function VaultActions({
  networkId,
  isViewOnly,
  depositCount,
  vaultId,
}: VaultActionsProps) {
  const actions = [
    { icon: <PlusCircle className="w-5 h-5" />, label: PRODUCT_COPY.actions.addFunds, href: "/vault/deposit", color: "text-warning" },
    { icon: <Send className="w-5 h-5" />, label: PRODUCT_COPY.actions.sendPrivately, href: "/send", color: "text-green-400" },
    { icon: <ArrowUpFromLine className="w-5 h-5" />, label: PRODUCT_COPY.actions.takeFundsOut, href: "/vault/withdraw", color: "text-purple-400" },
  ].filter((action) => !isViewOnly || action.label === PRODUCT_COPY.actions.sendPrivately);

  return (
    <>
      <div
        className={cn(
          "mx-auto grid w-full max-w-[300px] items-start gap-3 sm:gap-5 mb-6",
          "grid-cols-3",
        )}
      >
        {actions.map((action) => (
          <Link
            key={action.label}
            href={hrefWithVault(hrefWithChain(action.href, networkId), vaultId)}
            className="group flex min-w-0 flex-col items-center gap-1.5 cursor-pointer"
          >
            <motion.div
              className={cn(
                "w-12 h-12 rounded-full flex items-center justify-center",
                "bg-muted/80 border border-gray/15",
                "group-hover:border-privacy/30 group-hover:bg-privacy/10",
                "transition-colors duration-200",
                action.color,
              )}
              whileHover={{ scale: 1.08, y: -2 }}
              whileTap={{ scale: 0.92 }}
              transition={{ type: "spring", stiffness: 400, damping: 17 }}
            >
              {action.icon}
            </motion.div>
            <span className="text-center text-[11px] leading-tight text-gray group-hover:text-foreground transition-colors">
              {action.label}
            </span>
          </Link>
        ))}
      </div>

      {depositCount > 0 && (
        <div className="flex justify-center mb-5">
          <Link
            href={hrefWithVault(hrefWithChain("/vault/activity", networkId), vaultId)}
            className="flex items-center gap-1 text-[11px] text-gray/40 hover:text-gray/60 transition-colors cursor-pointer"
          >
            View activity <ChevronRight className="w-3 h-3" />
          </Link>
        </div>
      )}
    </>
  );
}
