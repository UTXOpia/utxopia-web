/**
 * Pure view-selection logic for the send ReviewModal. Kept free of React/DOM
 * imports so the state machine that decides confirm → progress → success →
 * error can be unit-tested directly.
 */

import type { SubmitStatus } from "@/hooks/use-joinsplit-submit";

export type ReviewView = "confirm" | "progress" | "success" | "error";

export const REVIEW_STEPS: { keys: SubmitStatus[]; label: string }[] = [
  { keys: ["preparing"], label: "Preparing transaction" },
  { keys: ["processing"], label: "Generating privacy proof" },
  { keys: ["submitting"], label: "Submitted and confirming" },
];

export const REVIEW_TITLES: Record<ReviewView, string> = {
  confirm: "Review payment",
  progress: "Sending payment",
  success: "Payment sent",
  error: "Payment failed",
};

/**
 * Which view the modal shows. Success and error are terminal and win over the
 * busy flag; a pre-submit throw surfaces as `errorMessage` while status is still
 * "idle" and `busy` has cleared, so that case routes to the error view too.
 */
export function selectReviewView(
  status: SubmitStatus,
  busy: boolean,
  errorMessage?: string | null,
): ReviewView {
  if (status === "success") return "success";
  if (status === "error" || (errorMessage && !busy)) return "error";
  if (busy) return "progress";
  return "confirm";
}

/** Index of the active progress step; pre-submit work (status "idle") maps to step 0. */
export function activeStepIndex(status: SubmitStatus): number {
  const i = REVIEW_STEPS.findIndex((s) => s.keys.includes(status));
  return i === -1 ? 0 : i;
}

/**
 * What the page-level error becomes when the review modal closes.
 *
 * Dismissing the modal is not an acknowledgement: Escape and an overlay click
 * both route through the same close handler, and clearing the failure there
 * left the member with an empty form and no reason given — the decoded program
 * error survived only in the console.
 */
export function errorAfterClose(
  status: SubmitStatus,
  submitError: string | null | undefined,
): string | null {
  return status === "error" ? (submitError ?? "The payment could not be completed.") : null;
}
