import { describe, expect, test } from "bun:test";
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
