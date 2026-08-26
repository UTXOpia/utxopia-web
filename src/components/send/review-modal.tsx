"use client";

import * as Dialog from "@radix-ui/react-dialog";
import { AlertCircle, Check, CheckCircle2, ChevronDown, ExternalLink, Loader2, LockKeyhole, X } from "lucide-react";
import { useState } from "react";
import { formatSpendDoc, type SpendDoc } from "@utxopia/sdk";
import { cn } from "@/lib/utils";
import { HoldButton } from "@/components/ui/hold-button";
import { RelayControl } from "@/components/relay/relay-control";
import type { SubmitStatus } from "@/hooks/use-joinsplit-submit";
import { TeeAttestationBadge } from "@/components/auditor/tee-attestation-panel";
import { useChainEnvironment } from "@/lib/chain-environment";
import { usePoolPermissioned } from "@/hooks/use-pool-permissioned";
import {
  activeStepIndex,
  REVIEW_STEPS as STEPS,
  REVIEW_TITLES as TITLES,
  selectReviewView,
} from "./review-modal-view";

export interface ReviewModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  recipientLabel: string;
  amountLabel: string;
  feeLabel: string;
  onConfirm: () => void | Promise<void>;
  details?: Array<{ label: string; value: string; strong?: boolean }>;
  privacyNote?: string;
  /** Optional warning row (e.g. BTC privacy notice). */
  warning?: string;
  /**
   * Exactly what the proof will be checked against. Null while the form is
   * incomplete; the confirm button is not reachable in that state anyway.
   */
  spendDoc?: SpendDoc | null;
  /** Relay registry chain id ("sol") for the per-tx relay line. */
  chainId: string;
  /** Full network id for relay health probing. */
  networkId: string;
  /** Submit lifecycle state from useJoinSplitSubmit. */
  status: SubmitStatus;
  /** True while the transaction is being prepared/proven/submitted (dismiss is blocked). */
  busy: boolean;
  /** Live status line from the submit hook. */
  statusMessage?: string;
  /** Seconds spent proving; the counter shows once it passes 3s. */
  provingElapsed?: number;
  /** Error text (pre-submit validation or relay failure). */
  errorMessage?: string | null;
  /** Explorer link for the confirmed transaction. */
  txHref?: string | null;
  /** Reset the error and return to the confirm view. */
  onRetry: () => void;
  /** Dismiss after success and clear the form. */
  onDone: () => void;
  /** Navigate to the activity page. */
  onViewActivity: () => void;
}

export function ReviewModal({
  open,
  onOpenChange,
  recipientLabel,
  amountLabel,
  feeLabel,
  details,
  privacyNote,
  onConfirm,
  warning,
  spendDoc,
  chainId,
  networkId,
  status,
  busy,
  statusMessage,
  provingElapsed,
  errorMessage,
  txHref,
  onRetry,
  onDone,
  onViewActivity,
}: ReviewModalProps) {
  const view = selectReviewView(status, busy, errorMessage);
  const [docOpen, setDocOpen] = useState(false);
  const chainEnv = useChainEnvironment();
  const { permissioned: poolPermissioned } = usePoolPermissioned();

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50" />
        <Dialog.Content
          className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-[420px] max-w-[calc(100vw-32px)] max-h-[90dvh] overflow-y-auto overscroll-contain bg-background border border-gray/20 rounded-2xl p-5 shadow-xl"
          // Block Esc / outside-click dismissal while a transaction is in flight —
          // the user can't cancel a proof mid-generation, and losing the modal
          // would hide the only live status.
          onEscapeKeyDown={(e) => busy && e.preventDefault()}
          onInteractOutside={(e) => busy && e.preventDefault()}
        >
          <div className="flex items-center justify-between mb-4">
            <Dialog.Title className="text-base font-semibold">
              {TITLES[view]}
            </Dialog.Title>
            <Dialog.Description className="sr-only">
              Confirm the recipient, amount, fees, and relay, then track the transaction to confirmation.
            </Dialog.Description>
            {!busy && (
              <Dialog.Close
                aria-label="Close"
                className="p-1 rounded hover:bg-muted/60 text-muted-foreground"
              >
                <X className="w-4 h-4" />
              </Dialog.Close>
            )}
          </div>

          {view === "confirm" && (
            <>
              <div className="space-y-3 text-sm">
                <Row label="To" value={recipientLabel} />
                {details?.length ? details.map((detail) => (
                  <Row key={detail.label} label={detail.label} value={detail.value} strong={detail.strong} />
                )) : (
                  <>
                    <Row label="Amount" value={amountLabel} />
                    <Row label="Total fees" value={feeLabel} />
                  </>
                )}
              </div>

              {privacyNote && (
                <div className="mt-3 flex items-start gap-2 border-t border-gray/10 pt-3 text-xs text-muted-foreground">
                  <LockKeyhole className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{privacyNote}</span>
                </div>
              )}

              {warning && (
                <div className="mt-3 px-2 py-1.5 rounded bg-yellow-500/10 text-yellow-600 text-xs">
                  {warning}
                </div>
              )}

              {spendDoc && (
                <div className="mt-3 border-t border-gray/10 pt-3">
                  <button
                    type="button"
                    onClick={() => setDocOpen((v) => !v)}
                    aria-expanded={docOpen}
                    className="flex w-full items-center justify-between text-xs text-muted-foreground hover:text-foreground"
                  >
                    <span>What this proof proves</span>
                    <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", docOpen && "rotate-180")} />
                  </button>
                  {docOpen && (
                    <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap break-all rounded bg-muted/40 p-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
                      {formatSpendDoc(spendDoc)}
                    </pre>
                  )}
                </div>
              )}

              {/* Per-tx relay line — low-emphasis reassurance, with an inline "Change" popover
                  (not a nested modal). Spends (transfer/unshield/redeem) are NOT auditor-gated;
                  viaAuditor stays false. */}
              <div className="mt-4 border-t border-gray/10 pt-3">
                <RelayControl chainId={chainId} networkId={networkId} viaAuditor={false} />
              </div>

              <div className="mt-5">
                <HoldButton onComplete={onConfirm} variant="primary" className="w-full">
                  Hold to confirm
                </HoldButton>
              </div>
            </>
          )}

          {view === "progress" && (
            <div className="py-2">
              <ol className="space-y-3">
                {STEPS.map((step, i) => {
                  const current = activeStepIndex(status);
                  const stepState = i < current ? "done" : i === current ? "active" : "pending";
                  return (
                    <li key={step.label} className="flex items-center gap-3 text-sm">
                      <StepIcon state={stepState} />
                      <span
                        className={cn(
                          stepState === "pending" && "text-muted-foreground/50",
                          stepState === "active" && "text-foreground font-medium",
                          stepState === "done" && "text-muted-foreground",
                        )}
                      >
                        {step.label}
                      </span>
                      {step.keys.includes("processing") &&
                        stepState === "active" &&
                        provingElapsed != null &&
                        provingElapsed >= 3 && (
                          <span className="ml-auto tabular-nums text-xs text-muted-foreground/70">
                            {provingElapsed}s
                          </span>
                        )}
                    </li>
                  );
                })}
              </ol>
              <p className="mt-4 border-t border-gray/10 pt-3 text-xs text-muted-foreground">
                {statusMessage || "Keep this tab open until the payment is submitted."}
              </p>
              {/* Same answer as on the deposit screen. A spend is where the
                  policy check actually decides something, so leaving it out
                  here would put the reassurance on the wrong screen. */}
              {poolPermissioned && (
                <TeeAttestationBadge
                  networkId={chainEnv.networkId}
                  vaultId={chainEnv.vaultId}
                  className="mt-3"
                />
              )}
            </div>
          )}

          {view === "success" && (
            <div className="space-y-4 py-4 text-center">
              <div className="inline-flex rounded-full border border-success/20 bg-success/10 p-3">
                <CheckCircle2 className="h-8 w-8 text-success" />
              </div>
              <div className="space-y-1">
                <p className="text-sm font-semibold text-foreground">{amountLabel}</p>
                <p className="font-mono text-xs text-muted-foreground break-all">
                  to {recipientLabel}
                </p>
              </div>
              {txHref && (
                <a
                  href={txHref}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-privacy transition-colors hover:text-privacy/80"
                >
                  View on explorer <ExternalLink className="h-3 w-3" />
                </a>
              )}
              <div className="flex gap-2 pt-1">
                <button
                  type="button"
                  onClick={onViewActivity}
                  className="flex-1 rounded-lg border border-gray/15 bg-muted/40 px-4 py-2.5 text-sm font-medium text-foreground transition-colors hover:bg-muted/60"
                >
                  View activity
                </button>
                <button
                  type="button"
                  onClick={onDone}
                  className="flex-1 rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
                >
                  Done
                </button>
              </div>
            </div>
          )}

          {view === "error" && (
            <div className="space-y-4 py-2">
              <div className="flex items-start gap-2 rounded-lg border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-500">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="break-words">{errorMessage || "The payment could not be completed."}</span>
              </div>
              <button
                type="button"
                onClick={onRetry}
                className="w-full rounded-lg bg-foreground px-4 py-2.5 text-sm font-medium text-background transition-opacity hover:opacity-90"
              >
                Try again
              </button>
            </div>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function StepIcon({ state }: { state: "done" | "active" | "pending" }) {
  if (state === "done") {
    return (
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-success/15 text-success">
        <Check className="h-3 w-3" />
      </span>
    );
  }
  if (state === "active") {
    return <Loader2 className="h-5 w-5 shrink-0 animate-spin text-foreground" />;
  }
  return (
    <span className="flex h-5 w-5 shrink-0 items-center justify-center">
      <span className="h-1.5 w-1.5 rounded-full bg-gray/30" />
    </span>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-xs text-muted-foreground shrink-0">{label}</span>
      <span className={cn("font-mono text-xs text-right break-all", strong && "font-semibold text-foreground")}>{value}</span>
    </div>
  );
}
