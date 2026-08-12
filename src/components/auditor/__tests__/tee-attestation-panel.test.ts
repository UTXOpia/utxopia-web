import { describe, expect, test } from "bun:test";
import {
  attestationAge,
  attestationVerdict,
  shortMeasurement,
  type TeeAttestation,
} from "../tee-attestation-panel";

const attestation = (pinned: boolean): TeeAttestation => ({
  measurement: "a755fc09121643d081090ff04201b06080850ccb152fa3cebdaf8d84c678b899",
  mrTd: "c1ee9c16",
  rtmr: ["c1f1f2bf", "b4fe8751", "51c09b72", "00".repeat(48)],
  tcbStatus: "UpToDate",
  advisoryIds: [],
  pinned,
  verifiedAt: 1_000,
});

describe("attestation verdict", () => {
  test("an unpinned quote is not a pass", () => {
    // It proves a genuine TDX enclave answered, not which one. Rendering that
    // as success is how a demo claims something it has not checked.
    expect(attestationVerdict(attestation(false), null)).toBe("unpinned");
    expect(attestationVerdict(attestation(true), null)).toBe("pinned");
  });

  test("an error outranks a stale success", () => {
    expect(attestationVerdict(attestation(true), "unavailable")).toBe("failed");
    expect(attestationVerdict(null, null)).toBe("failed");
  });

  test("a backend without the endpoint is absent, not failed", () => {
    // The frontend deploys separately from the backend, so 404 is the normal
    // state mid-rollout. Painting it red says an enclave failed to prove
    // itself — the opposite claim, and alarming in the middle of a deposit.
    expect(attestationVerdict(null, "Attestation returned 404", 404)).toBe("absent");
    expect(attestationVerdict(null, "Policy unavailable", 503)).toBe("failed");
  });
});

describe("presentation", () => {
  test("age never runs backwards on a clock skew", () => {
    expect(attestationAge(1_000, 500_000)).toBe("0s ago");
    expect(attestationAge(1_000, 1_030_000)).toBe("30s ago");
    expect(attestationAge(1_000, 1_090_000)).toBe("1m ago");
    expect(attestationAge(1_000, 8_200_000)).toBe("2h ago");
  });

  test("truncation keeps both ends so a mismatch is still visible", () => {
    const short = shortMeasurement(attestation(true).measurement);
    expect(short.startsWith("a755fc0912")).toBe(true);
    expect(short.endsWith("daf8d84c678b899".slice(-10))).toBe(true);
    expect(shortMeasurement("abc")).toBe("abc");
  });
});
