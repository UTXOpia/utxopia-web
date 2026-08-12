import { describe, expect, test } from "bun:test";
import { publicStatus, publicTimeline } from "./policy-public";

const backendBody = {
  requestId: "r-1",
  stage: "awaiting_signature",
  actor: "uFBMJSxoGkHj2NyncPzAkhNWsGSQirQcRjUnGfEfWg1",
  member: "8YFnUjU6CWWK1M4VvzTuZKmywpvxXuMQvhsKkFizZtvS",
  action: 14,
  approvalAccount: "GWv7jsEx",
  approvalSignature: "sig-a:sig-b",
  assetSignature: "sig-c",
  createdAt: 1,
  updatedAt: 2,
  timeline: [
    { stage: "policy_checking", atMs: 1000 },
    { stage: "approved", atMs: 1240 },
  ],
};

describe("policy status allowlist", () => {
  test("the backend's identity fields never reach the browser", () => {
    const publicKeys = Object.keys(publicStatus(backendBody)).sort();
    expect(publicKeys).toEqual(["approvalAccount", "requestId", "stage", "timeline"]);
    // Named explicitly: a future field added to the backend struct must fail
    // here rather than silently ship to a page.
    for (const leaked of ["actor", "member", "approvalSignature", "assetSignature"]) {
      expect(publicKeys).not.toContain(leaked);
    }
  });

  test("timeline survives with millisecond marks", () => {
    const { timeline } = publicStatus(backendBody);
    expect(timeline).toEqual([
      { stage: "policy_checking", atMs: 1000 },
      { stage: "approved", atMs: 1240 },
    ]);
    // The number the demo reads off the screen.
    expect(timeline[1].atMs - timeline[0].atMs).toBe(240);
  });

  test("a malformed timeline is dropped, not forwarded", () => {
    expect(publicTimeline(undefined)).toEqual([]);
    expect(publicTimeline("not-an-array")).toEqual([]);
    expect(publicTimeline([null, 7, { stage: "approved" }, { atMs: 1 }])).toEqual([]);
    expect(publicTimeline([{ stage: "approved", atMs: 5, extra: "x" }])).toEqual([
      { stage: "approved", atMs: 5 },
    ]);
  });
});
