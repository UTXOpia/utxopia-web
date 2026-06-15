"use client";

/**
 * RelayControl — compact, low-emphasis per-transaction relay line.
 *
 * Rendered at the send/withdraw review step as reassurance (not a primary
 * control). Shows the relay that will carry this transaction:
 *
 *   ◦ Relay · Auto · Utxopia relay · 42ms          [Change]
 *
 * "Change" opens a small Radix Popover (NOT a modal) containing the same
 * relay rows as the settings selector. Selecting there updates the SAME
 * useRelayStore mode.
 *
 * Per-tx override decision: the per-transaction override currently shares the
 * global default store (useRelayStore.mode). Changing the relay here changes
 * the default — there is no transaction-scoped override yet. A true per-tx
 * override would need a local `mode` state that is consulted by the submit
 * path; that is intentionally deferred to keep one source of truth. The
 * shared `RelayRows` already makes adding a local override cheap later.
 */

import { useState } from "react";
import * as Popover from "@radix-ui/react-popover";
import { ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useEffectiveRelay } from "@/hooks/use-relay";
import { useRelayStore } from "@/stores/relay-store";
import {
  HealthDot,
  HEALTH_CONFIG,
  RelayRows,
  useRelayHealthChecks,
} from "@/components/relay/relay-rows";

interface RelayControlProps {
  /** Relay registry chain id: "sui" or "sol". */
  chainId: string;
  /** Full network id — passed to relay.url() when pinging. */
  networkId: string;
  /**
   * When true, the transaction is submitted through the connected pool's
   * auditor (permissioned-pool value-entry must route via the auditor), so the
   * relay picker is replaced with an informational row.
   *
   * Dormant today: the web app has no permissioned-pool context yet, so every
   * current call site passes the default `false`. This lights up once the app
   * tracks permissioned pools.
   */
  viaAuditor?: boolean;
  className?: string;
}

export function RelayControl({
  chainId,
  networkId,
  viaAuditor = false,
  className,
}: RelayControlProps) {
  const mode = useRelayStore((s) => s.mode);
  const health = useRelayStore((s) => s.health);
  const setMode = useRelayStore((s) => s.setMode);
  const effective = useEffectiveRelay(chainId);
  const checks = useRelayHealthChecks(chainId, networkId);
  const [open, setOpen] = useState(false);

  // Permissioned-pool path: route through the auditor, no relay choice.
  if (viaAuditor) {
    return (
      <div
        className={cn(
          "flex items-center gap-2 text-[11px] text-gray",
          className,
        )}
        role="note"
      >
        <ShieldCheck className="h-3.5 w-3.5 shrink-0 text-gray" aria-hidden />
        <span>Submitted via your pool&apos;s auditor</span>
      </div>
    );
  }

  // Resolve the compact caption: "Auto · Utxopia relay · 42ms" or "Utxopia relay · 42ms".
  const isAuto = mode === "auto";
  const isChecking = !!effective && checks.checking.has(effective.id);
  const effectiveHealth = effective ? (health[effective.id] ?? null) : null;
  const statusKey: keyof typeof HEALTH_CONFIG = isChecking
    ? "checking"
    : (effectiveHealth?.status ?? "checking");

  const parts: string[] = [];
  if (isAuto) parts.push("Auto");
  if (effective) parts.push(effective.name);
  if (!isChecking && effectiveHealth?.latencyMs != null) {
    parts.push(`${effectiveHealth.latencyMs}ms`);
  } else if (isChecking) {
    parts.push("checking…");
  }
  const caption = parts.join(" · ") || "No healthy relay";

  return (
    <div
      className={cn(
        "flex items-center justify-between gap-3 text-[11px]",
        className,
      )}
    >
      <span className="inline-flex min-w-0 items-center gap-1.5 text-gray">
        <HealthDot status={statusKey} />
        <span className="shrink-0 text-gray">Relay</span>
        <span className="text-gray/40" aria-hidden>
          ·
        </span>
        <span className="truncate text-gray">{caption}</span>
      </span>

      <Popover.Root open={open} onOpenChange={setOpen}>
        <Popover.Trigger asChild>
          <button
            type="button"
            className={cn(
              "shrink-0 rounded px-1.5 py-0.5 text-[11px] font-medium text-gray-light",
              "transition-colors duration-150 motion-reduce:transition-none",
              "hover:bg-gray/10 hover:text-foreground active:scale-[0.97]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-privacy focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            )}
          >
            Change
          </button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            align="end"
            sideOffset={8}
            collisionPadding={16}
            className={cn(
              "z-50 w-[340px] max-w-[calc(100vw-32px)] rounded-2xl border border-gray/20 bg-background p-4 shadow-xl",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              "motion-reduce:data-[state=open]:animate-none motion-reduce:data-[state=closed]:animate-none",
            )}
          >
            <div className="mb-3 flex items-baseline justify-between">
              <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-gray-light">
                Relay for this transaction
              </p>
            </div>
            <RelayRows
              mode={mode}
              effective={effective}
              onSelect={setMode}
              health={health}
              checks={checks}
            />
            <Popover.Arrow className="fill-gray/20" />
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
    </div>
  );
}
