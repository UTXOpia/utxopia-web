"use client";

import { AlertCircle, CheckCircle2, Loader2, RefreshCw } from "lucide-react";
import { useNotesStore } from "@/stores/notes-store";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { useDepositStatus } from "@/hooks/use-deposit-status";
import { getDepositProgress, getStatusMessage } from "@/lib/api/deposits";
import { cn } from "@/lib/utils";

/**
 * Live "pending → confirming → swept → minted" tracker for a BTC deposit.
 *
 * The deposit's backend `depositId` is registered asynchronously after broadcast
 * and lands on the note. We read it reactively from the notes store by the note's
 * local id and drive the existing useDepositStatus hook (WS + poll fallback), so
 * the user sees real confirmation progress instead of a static "submitted".
 */
export function DepositStatusTracker({
  noteId,
  showRefresh = false,
  className,
}: {
  noteId: string;
  /** Adds a manual re-check. The hook already polls; this is for the member who
   *  just paid from another device and wants an answer now rather than in 10s. */
  showRefresh?: boolean;
  className?: string;
}) {
  const depositId = useNotesStore(
    (s) => s.notes.find((n) => n.id === noteId)?.depositId ?? null,
  );
  const { status, confirmations, sweepConfirmations, refresh } = useDepositStatus(depositId);

  const recheck = () => {
    void refresh();
    void useUTXOpiaStore.getState().refreshInbox(undefined, true);
  };

  // Backend hasn't acknowledged the deposit yet (registration still in flight).
  if (!depositId || !status) {
    return (
      <div className={cn("flex items-center justify-center gap-2 text-caption text-gray", className)}>
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
        <span>Tracking deposit…</span>
        {showRefresh && (
          <button
            type="button"
            onClick={recheck}
            title="Check now"
            className="transition-colors hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    );
  }

  const progress = getDepositProgress(status, confirmations, sweepConfirmations);
  const label = getStatusMessage(status);
  const done = status === "ready" || status === "claimed";
  const failed = status === "failed";

  return (
    <div className={cn("mx-auto w-full max-w-xs space-y-2 text-left", className)}>
      <div className="flex items-center justify-between gap-2 text-caption">
        <span
          className={cn(
            "flex items-center gap-1.5",
            done ? "text-success" : failed ? "text-red-500" : "text-gray-light",
          )}
        >
          {done ? (
            <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          ) : failed ? (
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
          ) : (
            <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
          )}
          {label}
        </span>
        <span className="flex shrink-0 items-center gap-2">
          {status === "confirming" && confirmations > 0 && (
            <span className="tabular-nums text-gray">{confirmations} conf</span>
          )}
          {showRefresh && (
            <button
              type="button"
              onClick={recheck}
              title="Check now"
              className="text-gray transition-colors hover:text-foreground"
            >
              <RefreshCw className="h-3.5 w-3.5" />
            </button>
          )}
        </span>
      </div>
      <div className="h-1 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out motion-reduce:transition-none",
            failed ? "bg-red-500" : done ? "bg-success" : "bg-btc",
          )}
          style={{ width: `${failed ? 100 : progress}%` }}
        />
      </div>
    </div>
  );
}
