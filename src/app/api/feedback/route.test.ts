import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { POST } from "./route";

let logPath: string;
let logDir: string;

// The rate limiter is module state keyed by IP, so every case gets its own.
let nextIp = 0;
function request(body: Record<string, unknown>): Request {
  nextIp += 1;
  return new Request("https://app.utxopia.test/api/feedback", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": `203.0.113.${nextIp}`,
      "user-agent": "test-agent",
    },
    body: JSON.stringify(body),
  });
}

async function entries() {
  const raw = await readFile(logPath, "utf8");
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

beforeAll(async () => {
  logDir = await mkdtemp(join(tmpdir(), "utxopia-feedback-"));
  logPath = join(logDir, "feedback.jsonl");
});

afterAll(async () => {
  await rm(logDir, { recursive: true, force: true });
});

describe("feedback intake", () => {
  it("fails loudly rather than accepting into nowhere", async () => {
    delete process.env.FEEDBACK_LOG_PATH;
    delete process.env.FEEDBACK_WEBHOOK_URL;

    const response = await POST(request({ message: "the withdraw button does nothing" }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ ok: false });
  });

  describe("with a sink configured", () => {
    beforeAll(() => {
      process.env.FEEDBACK_LOG_PATH = logPath;
    });

    it("records a message and the page it came from", async () => {
      const response = await POST(request({
        kind: "bug",
        message: "the withdraw button does nothing",
        page: "/vault/withdraw",
        network: "devnet",
      }));

      expect(response.status).toBe(200);
      const [entry] = await entries();
      expect(entry).toMatchObject({
        kind: "bug",
        message: "the withdraw button does nothing",
        page: "/vault/withdraw",
        network: "devnet",
        email: null,
        wants_session: false,
      });
    });

    it("never forwards identity the client tried to attach", async () => {
      const response = await POST(request({
        message: "just checking",
        wallet: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
        notes: [{ commitment: "0xdead" }],
        seed: "do not send this",
      }));

      expect(response.status).toBe(200);
      const written = await entries();
      const entry = written[written.length - 1];
      expect(Object.keys(entry).sort()).toEqual([
        "email",
        "kind",
        "message",
        "network",
        "page",
        "received_at",
        "user_agent",
        "wants_session",
      ]);
    });

    it("requires a message", async () => {
      const response = await POST(request({ message: " " }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({ error: "message is required" });
    });

    it("refuses a 1-on-1 with no way to reach the member", async () => {
      const response = await POST(request({ message: "happy to talk", wantsSession: true }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "a 1-on-1 needs an email to reach you at",
      });
    });

    it("rejects an email that cannot receive mail", async () => {
      const response = await POST(request({ message: "hi", email: "not-an-address" }));
      expect(response.status).toBe(400);
    });

    it("keeps the email and the session opt-in together", async () => {
      const response = await POST(request({
        message: "call me",
        email: "member@example.com",
        wantsSession: true,
      }));

      expect(response.status).toBe(200);
      const written = await entries();
      expect(written[written.length - 1]).toMatchObject({
        email: "member@example.com",
        wants_session: true,
      });
    });

    it("falls back to 'other' for an unknown kind", async () => {
      const response = await POST(request({ message: "hello", kind: "urgent!!" }));
      expect(response.status).toBe(200);
      const written = await entries();
      expect(written[written.length - 1].kind).toBe("other");
    });

    it("rate limits a single reporter", async () => {
      const ip = "198.51.100.7";
      const send = () =>
        POST(new Request("https://app.utxopia.test/api/feedback", {
          method: "POST",
          headers: { "Content-Type": "application/json", "x-forwarded-for": ip },
          body: JSON.stringify({ message: "spam" }),
        }));

      const statuses: number[] = [];
      for (let i = 0; i < 7; i += 1) statuses.push((await send()).status);

      expect(statuses.filter((s) => s === 200).length).toBe(5);
      expect(statuses[statuses.length - 1]).toBe(429);
    });
  });
});
