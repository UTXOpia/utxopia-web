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
  return new Request("https://app.utxopia.test/api/apply", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": `203.0.113.${nextIp}`,
      "user-agent": "test-agent",
    },
    body: JSON.stringify(body),
  });
}

const complete = {
  email: "someone@example.com",
  who: "github.com/someone",
  useCase: "payroll for two contractors who should not see each other's rate",
  cliOk: true,
  background: "ran a Zcash full node for a while",
  distrust: "if you shipped a change to the exit path without saying so",
};

async function entries() {
  const raw = await readFile(logPath, "utf8");
  return raw.trim().split("\n").filter(Boolean).map((line) => JSON.parse(line));
}

beforeAll(async () => {
  logDir = await mkdtemp(join(tmpdir(), "utxopia-apply-"));
  logPath = join(logDir, "apply.jsonl");
});

afterAll(async () => {
  await rm(logDir, { recursive: true, force: true });
});

describe("beta applications", () => {
  it("fails loudly rather than accepting into nowhere", async () => {
    delete process.env.APPLY_LOG_PATH;
    delete process.env.APPLY_WEBHOOK_URL;
    delete process.env.FEEDBACK_LOG_PATH;
    delete process.env.FEEDBACK_WEBHOOK_URL;
    delete process.env.RESEND_API_KEY;
    delete process.env.INTAKE_EMAIL_TO;

    const response = await POST(request(complete));

    expect(response.status).toBe(503);
  });

  it("falls back to the feedback sink, so one webhook covers both forms", async () => {
    process.env.FEEDBACK_LOG_PATH = logPath;

    const response = await POST(request(complete));

    expect(response.status).toBe(200);
    const [entry] = await entries();
    expect(entry).toMatchObject({ email: "someone@example.com", cli_ok: true });
  });

  describe("with a sink configured", () => {
    beforeAll(() => {
      process.env.APPLY_LOG_PATH = logPath;
    });

    it("never forwards identity the client tried to attach", async () => {
      const response = await POST(request({
        ...complete,
        wallet: "9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin",
        seed: "do not send this",
      }));

      expect(response.status).toBe(200);
      const written = await entries();
      expect(Object.keys(written[written.length - 1]).sort()).toEqual([
        "background",
        "cli_ok",
        "distrust",
        "email",
        "network",
        "received_at",
        "source",
        "use_case",
        "user_agent",
        "who",
      ]);
    });

    it("needs an address a code could actually go to", async () => {
      const response = await POST(request({ ...complete, email: "not-an-address" }));
      expect(response.status).toBe(400);
    });

    it("holds out for the question that pays back", async () => {
      const response = await POST(request({ ...complete, distrust: "  " }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "the last question is the one we most want answered",
      });
    });

    it("treats an unanswered CLI question as unanswered, not as no", async () => {
      const { cliOk, ...withoutAnswer } = complete;
      void cliOk;
      const response = await POST(request(withoutAnswer));
      expect(response.status).toBe(400);
    });

    it("issues nothing — an application is a record, not an admission", async () => {
      const response = await POST(request(complete));
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true });
    });

    it("mails the application with the applicant as reply-to", async () => {
      process.env.RESEND_API_KEY = "re_test";
      // Comma-separated: intake can reach a shared address and a personal one.
      process.env.INTAKE_EMAIL_TO = "beta@utxopia.com, info@utxopia.com";
      const realFetch = globalThis.fetch;
      let sent: Record<string, unknown> | null = null;
      globalThis.fetch = (async (url: string, init: RequestInit) => {
        sent = JSON.parse(String(init.body));
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch;

      try {
        const response = await POST(request(complete));
        expect(response.status).toBe(200);
      } finally {
        globalThis.fetch = realFetch;
        delete process.env.RESEND_API_KEY;
        delete process.env.INTAKE_EMAIL_TO;
      }

      // Replying to the mail is how a code goes out, so it has to reach the
      // applicant and not us.
      expect(sent).toMatchObject({
        to: ["beta@utxopia.com", "info@utxopia.com"],
        reply_to: "someone@example.com",
        subject: "beta application — someone@example.com",
      });
    });
  });
});
