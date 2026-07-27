"use client";

import { useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

type ApplyStatus = "idle" | "sending" | "sent" | "error";

/**
 * One-tap allowlist application for the Verified Privacy vault. Shown next to
 * the policy-rejection error; submits the wallet address to the operator's
 * review queue.
 */
export function ApplyForAccess({
  actor,
  networkId,
  className,
}: {
  actor: string;
  networkId: string;
  className?: string;
}) {
  const [status, setStatus] = useState<ApplyStatus>("idle");

  const apply = async () => {
    setStatus("sending");
    try {
      const response = await fetch(
        `/api/access-requests?network=${encodeURIComponent(networkId)}&vault=verified`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ actor }),
        },
      );
      if (!response.ok) throw new Error(`access request failed (${response.status})`);
      setStatus("sent");
    } catch {
      setStatus("error");
    }
  };

  if (status === "sent") {
    return (
      <div
        className={cn(
          "flex items-center gap-2 rounded-[10px] border border-gray/15 bg-muted px-3 py-2.5 text-caption text-gray-light",
          className,
        )}
        role="status"
      >
        <Check className="h-4 w-4 shrink-0 text-privacy" aria-hidden />
        <span>
          <strong className="text-foreground">Application received.</strong>{" "}
          The operator reviews new wallets before they can use Verified Privacy.
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-1.5", className)}>
      <button
        type="button"
        onClick={apply}
        disabled={status === "sending"}
        className={cn(
          "flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px] border border-gray/20",
          "px-3 py-2.5 text-caption font-semibold text-foreground transition-colors",
          "hover:border-gray/40 disabled:cursor-not-allowed disabled:opacity-60",
        )}
      >
        {status === "sending" && (
          <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
        )}
        {status === "sending" ? "Sending application..." : "Apply for access"}
      </button>
      {status === "error" && (
        <span className="text-[11px] text-red-400" role="alert">
          Could not send the application. Try again.
        </span>
      )}
    </div>
  );
}
