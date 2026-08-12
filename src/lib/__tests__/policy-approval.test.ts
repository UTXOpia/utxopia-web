import { decisionMs } from "@/lib/policy-approval";
import { describe, expect, test } from "bun:test";

describe("decision latency", () => {
  test("measures request-to-verdict, not the whole settlement", () => {
    // Everything after the verdict is Solana finality, which PER does not
    // change — folding it in would understate the thing being demonstrated.
    const timeline = [
      { stage: "policy_checking", atMs: 1_000 },
      { stage: "approved", atMs: 1_180 },
      { stage: "awaiting_signature", atMs: 1_190 },
      { stage: "submitted_to_solana", atMs: 2_400 },
      { stage: "finalized", atMs: 9_900 },
    ];
    expect(decisionMs(timeline)).toBe(180);
  });

  test("a refusal is timed the same as an approval", () => {
    // Both verdicts take the same path by design, so the demo must not be able
    // to read latency as an oracle for the decision.
    expect(
      decisionMs([
        { stage: "policy_checking", atMs: 500 },
        { stage: "rejected", atMs: 680 },
      ]),
    ).toBe(180);
  });

  test("no verdict yet is null, not zero", () => {
    expect(decisionMs(undefined)).toBeNull();
    expect(decisionMs([])).toBeNull();
    expect(decisionMs([{ stage: "policy_checking", atMs: 1 }])).toBeNull();
  });
});
import { isPolicyRejection, policyFailureMessage } from "../policy-approval";

describe("policyFailureMessage", () => {
  test("rejected with allowlist detail explains how to proceed", () => {
    const msg = policyFailureMessage(
      "rejected",
      "actor is not in the verified-vault allowlist",
    );
    expect(msg).toContain("isn't approved for Verified Privacy");
    expect(msg).toContain("actor is not in the verified-vault allowlist");
    expect(msg).toContain("Open Privacy");
  });

  test("rejected without detail still gives an actionable message", () => {
    const msg = policyFailureMessage("rejected");
    expect(msg).toContain("isn't approved for Verified Privacy");
    expect(msg).toContain("allowlist");
  });

  test("failed passes through backend detail", () => {
    expect(policyFailureMessage("failed", "PER unreachable")).toBe("PER unreachable");
    expect(policyFailureMessage("failed")).toBe("Policy request failed");
  });
});

describe("isPolicyRejection", () => {
  test("matches rejection messages and nothing else", () => {
    expect(isPolicyRejection(policyFailureMessage("rejected"))).toBe(true);
    expect(
      isPolicyRejection(
        policyFailureMessage("rejected", "actor is not in the verified-vault allowlist"),
      ),
    ).toBe(true);
    expect(isPolicyRejection(policyFailureMessage("failed", "PER unreachable"))).toBe(false);
    expect(isPolicyRejection(null)).toBe(false);
    expect(isPolicyRejection("Add funds failed")).toBe(false);
  });
});
