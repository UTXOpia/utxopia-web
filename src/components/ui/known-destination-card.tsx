"use client";

import { Pencil } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * A destination the app already knows — your own private vault on deposit,
 * your connected wallet on cash-out — shown instead of an empty field, with
 * one obvious way out of it.
 */
export interface KnownDestinationCardProps {
  icon: React.ReactNode;
  title: string;
  /** Full address; truncated for display. */
  value: string;
  onEdit: () => void;
  editTestId?: string;
  className?: string;
}

export function truncateAddress(value: string): string {
  return value.length > 24 ? `${value.slice(0, 12)}...${value.slice(-8)}` : value;
}

export function KnownDestinationCard({
  icon,
  title,
  value,
  onEdit,
  editTestId,
  className,
}: KnownDestinationCardProps) {
  return (
    <div className={cn("rounded-[10px] border border-privacy/25 bg-privacy/8 px-3 py-3", className)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2">
          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-privacy/10">
            {icon}
          </div>
          <div className="min-w-0">
            <p className="text-body2-semibold text-foreground">{title}</p>
            <p className="truncate font-mono text-[11px] text-gray/50">{truncateAddress(value)}</p>
          </div>
        </div>
        <button
          type="button"
          onClick={onEdit}
          data-testid={editTestId}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-[8px] border border-gray/15 bg-muted/40 px-2.5 py-1.5 text-[11px] text-gray-light transition-colors hover:border-privacy/30 hover:text-foreground"
        >
          <Pencil className="h-3 w-3" />
          Edit
        </button>
      </div>
    </div>
  );
}
