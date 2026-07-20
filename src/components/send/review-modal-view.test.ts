import { describe, expect, it } from "bun:test";
import { activeStepIndex, selectReviewView } from "./review-modal-view";

describe("selectReviewView", () => {
  it("shows the confirm view before submission", () => {
    expect(selectReviewView("idle", false, null)).toBe("confirm");
  });

  it("shows progress while preparing, proving, and submitting", () => {
    expect(selectReviewView("preparing", true, null)).toBe("progress");
    expect(selectReviewView("processing", true, null)).toBe("progress");
    expect(selectReviewView("submitting", true, null)).toBe("progress");
  });

  it("shows progress during pre-submit work even before the hook sets a status", () => {
    // onSend flips `submitting` true immediately; the hook is still "idle" until
    // submit() runs. The modal must read that as in-flight, not confirm.
    expect(selectReviewView("idle", true, null)).toBe("progress");
  });

  it("shows the terminal success view", () => {
    expect(selectReviewView("success", false, null)).toBe("success");
  });

  it("shows the error view on a relay failure", () => {
    expect(selectReviewView("error", false, "relay rejected")).toBe("error");
  });

  it("routes a pre-submit throw (idle status, no longer busy, error set) to error", () => {
    expect(selectReviewView("idle", false, "Vault locked")).toBe("error");
  });

  it("keeps showing progress if an error string lingers while still busy", () => {
    // busy wins over a stale error message: never flash an error mid-flight.
    expect(selectReviewView("processing", true, "stale")).toBe("progress");
  });

  it("never blocks the success view behind an error string", () => {
    expect(selectReviewView("success", false, "ignored")).toBe("success");
  });
});

describe("activeStepIndex", () => {
  it("maps each submit status to its step, defaulting pre-submit to step 0", () => {
    expect(activeStepIndex("idle")).toBe(0);
    expect(activeStepIndex("preparing")).toBe(0);
    expect(activeStepIndex("processing")).toBe(1);
    expect(activeStepIndex("submitting")).toBe(2);
  });
});
