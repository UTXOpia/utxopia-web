import { test, expect } from "bun:test";
import { submitWithFailover, defaultIsRetriable } from "./relay-submit";

// --- defaultIsRetriable ---

test("defaultIsRetriable: TypeError is retriable", () => {
  expect(defaultIsRetriable(new TypeError("Failed to fetch"))).toBe(true);
});

test("defaultIsRetriable: AbortError is retriable", () => {
  const e = new DOMException("aborted", "AbortError");
  expect(defaultIsRetriable(e)).toBe(true);
});

test("defaultIsRetriable: timeout message is retriable", () => {
  expect(defaultIsRetriable(new Error("Request timed out"))).toBe(true);
});

test("defaultIsRetriable: validation error is NOT retriable", () => {
  expect(defaultIsRetriable(new Error("Invalid proof"))).toBe(false);
});

test("defaultIsRetriable: proof rejection is NOT retriable", () => {
  expect(defaultIsRetriable(new Error("Proof verification failed"))).toBe(false);
});

// --- submitWithFailover ---

test("all-fail throws last error", async () => {
  const err1 = new TypeError("fetch failed relay-1");
  const err2 = new TypeError("fetch failed relay-2");
  const err3 = new TypeError("fetch failed relay-3");
  const errors = [err1, err2, err3];
  let i = 0;
  const submit = async (_url: string) => { throw errors[i++]; };

  await expect(
    submitWithFailover(submit, ["u1", "u2", "u3"])
  ).rejects.toBe(err3);
  expect(i).toBe(3);
});

test("first-success short-circuits: second candidate never called", async () => {
  let calls = 0;
  const submit = async (_url: string) => {
    calls++;
    return "ok";
  };

  const result = await submitWithFailover(submit, ["u1", "u2"]);
  expect(result).toBe("ok");
  expect(calls).toBe(1);
});

test("non-retriable error fails immediately without trying others", async () => {
  const validationErr = new Error("Invalid nullifier — already spent");
  let calls = 0;
  const submit = async (_url: string) => {
    calls++;
    throw validationErr;
  };

  await expect(
    submitWithFailover(submit, ["u1", "u2", "u3"])
  ).rejects.toBe(validationErr);
  expect(calls).toBe(1);
});

test("onFailover called with correct args on retriable failure", async () => {
  const failoverCalls: Array<{ failed: string; next: string }> = [];
  const submit = async (url: string) => {
    if (url === "u1") throw new TypeError("fetch failed");
    return "ok from u2";
  };

  const result = await submitWithFailover(submit, ["u1", "u2"], {
    onFailover: (failedUrl, nextUrl) => {
      failoverCalls.push({ failed: failedUrl, next: nextUrl });
    },
  });

  expect(result).toBe("ok from u2");
  expect(failoverCalls).toEqual([{ failed: "u1", next: "u2" }]);
});

test("empty candidates throws immediately", async () => {
  await expect(
    submitWithFailover(async () => "never", [])
  ).rejects.toThrow("No relay candidates available");
});
