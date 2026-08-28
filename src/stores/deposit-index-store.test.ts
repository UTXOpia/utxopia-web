import { beforeEach, describe, expect, test } from "bun:test";
import { useDepositIndexStore } from "./deposit-index-store";

const A = "identity-a";
const B = "identity-b";

beforeEach(() => useDepositIndexStore.setState({ next: {} }));

describe("deposit index", () => {
  test("starts at 0 and never hands out the same index twice", () => {
    const s = useDepositIndexStore.getState();
    expect(s.claim(A)).toBe(0);
    expect(s.claim(A)).toBe(1);
    expect(s.claim(A)).toBe(2);
  });

  test("identities do not share a counter", () => {
    const s = useDepositIndexStore.getState();
    s.claim(A);
    s.claim(A);
    // B's indices are derived under a different viewing key, so A's say nothing.
    expect(s.claim(B)).toBe(0);
    expect(useDepositIndexStore.getState().peek(A)).toBe(2);
  });

  /// A scan can only tell us an index was used, never that one was not — an
  /// address derived moments ago may not be visible yet. So observing must raise
  /// the floor and never lower it, or a rescan would hand back an index that is
  /// already spoken for and link two deposits together.
  test("observing raises the floor but never lowers it", () => {
    const s = useDepositIndexStore.getState();
    s.claim(A);
    s.claim(A);
    expect(useDepositIndexStore.getState().peek(A)).toBe(2);

    s.observe(A, 9);
    expect(useDepositIndexStore.getState().peek(A)).toBe(10);

    s.observe(A, 3);
    expect(useDepositIndexStore.getState().peek(A)).toBe(10);

    expect(useDepositIndexStore.getState().claim(A)).toBe(10);
  });

  test("a fresh wallet observing a scan resumes past it", () => {
    const s = useDepositIndexStore.getState();
    s.observe(A, 4);
    expect(s.claim(A)).toBe(5);
  });
});
