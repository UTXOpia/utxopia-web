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
  roles: ["Engineer", "Bitcoiner"],
  reason: "payroll for two contractors who should not see each other's rate",
  emailOptIn: true,
  feedbackOptIn: true,
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
    expect(entry).toMatchObject({ email: "someone@example.com", feedback_opt_in: true });
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
        "email",
        "email_opt_in",
        "feedback_opt_in",
        "network",
        "reason",
        "received_at",
        "roles",
        "user_agent",
      ]);
    });

    it("needs an address a code could actually go to", async () => {
      const response = await POST(request({ ...complete, email: "not-an-address" }));
      expect(response.status).toBe(400);
    });

    it("holds out for the one question left", async () => {
      const response = await POST(request({ ...complete, reason: "  " }));
      expect(response.status).toBe(400);
      expect(await response.json()).toMatchObject({
        error: "tell us why you're interested — a couple of sentences is plenty",
      });
    });

    it("records an unticked opt-in as a no, never as unset", async () => {
      const { emailOptIn, feedbackOptIn, ...withoutConsent } = complete;
      void emailOptIn;
      void feedbackOptIn;
      const response = await POST(request(withoutConsent));

      expect(response.status).toBe(200);
      const written = await entries();
      expect(written[written.length - 1]).toMatchObject({
        email_opt_in: false,
        feedback_opt_in: false,
      });
    });

    it("keeps the role buckets to the known set", async () => {
      const response = await POST(request({
        ...complete,
        roles: ["Engineer", "Supreme Overlord", "Engineer"],
      }));

      expect(response.status).toBe(200);
      const written = await entries();
      // Unknown dropped, duplicate collapsed.
      expect(written[written.length - 1]).toMatchObject({ roles: ["Engineer"] });
    });

    it("stores roles in a stable order however they were ticked", async () => {
      const response = await POST(request({ ...complete, roles: ["Bitcoiner", "Engineer"] }));

      expect(response.status).toBe(200);
      const written = await entries();
      expect(written[written.length - 1]).toMatchObject({
        roles: ["Engineer", "Bitcoiner"],
      });
    });

    it("does not take a truthy string as consent", async () => {
      const response = await POST(request({ ...complete, emailOptIn: "yes" }));

      expect(response.status).toBe(200);
      const written = await entries();
      expect(written[written.length - 1]).toMatchObject({ email_opt_in: false });
    });

    it("issues nothing when auto-issue is not configured", async () => {
      const response = await POST(request(complete));
      expect(response.status).toBe(200);
      // `invited` is what the form reads to decide between "check your mail for
      // a code" and "give it a day" — with no admin key there is no code.
      expect(await response.json()).toEqual({ ok: true, invited: false });
    });

    /** Capture every Resend call a submission makes. */
    async function submitWithMail(
      body: Record<string, unknown>,
      status = 200,
    ): Promise<{ response: Response; mails: Record<string, unknown>[] }> {
      process.env.RESEND_API_KEY = "re_test";
      // Comma-separated: intake can reach a shared address and a personal one.
      process.env.INTAKE_EMAIL_TO = "beta@utxopia.com, info@utxopia.com";
      const realFetch = globalThis.fetch;
      const mails: Record<string, unknown>[] = [];
      globalThis.fetch = (async (_url: string, init: RequestInit) => {
        mails.push(JSON.parse(String(init.body)));
        return new Response("{}", { status });
      }) as unknown as typeof fetch;

      try {
        return { response: await POST(request(body)), mails };
      } finally {
        globalThis.fetch = realFetch;
        delete process.env.RESEND_API_KEY;
        delete process.env.INTAKE_EMAIL_TO;
      }
    }

    it("sends exactly one mail, and never a copy to us", async () => {
      const { response, mails } = await submitWithMail(complete);
      expect(response.status).toBe(200);

      // The operator's copy is /admin/applications, not an inbox. Mailing one
      // used to double the send count per application, and on a metered tier the
      // second mail is what pushes the first — the one carrying the code — over
      // the limit. INTAKE_EMAIL_TO is a reply-to here, not a recipient.
      expect(mails).toHaveLength(1);
      expect(mails[0]).toMatchObject({ to: ["someone@example.com"] });
    });

    it("sends the applicant a receipt that replies back to intake", async () => {
      const { response, mails } = await submitWithMail(complete);
      expect(response.status).toBe(200);

      expect(mails[0]).toMatchObject({
        to: ["someone@example.com"],
        reply_to: "beta@utxopia.com",
        subject: "We got your UTXOpia application",
      });
    });

    it("never echoes what the applicant typed back to them", async () => {
      // The endpoint is unauthenticated and mails whatever address it is
      // handed. Reflecting free text would make it a way to deliver arbitrary
      // content to an arbitrary inbox, signed by our domain.
      const smuggled = "CLICK http://evil.example TO CLAIM YOUR CODE";
      const { mails } = await submitWithMail({ ...complete, reason: smuggled });

      const receipt = JSON.stringify(mails[0]);
      expect(receipt).not.toContain(smuggled);
      expect(receipt).not.toContain("evil.example");
    });

    it("still accepts the application when the receipt cannot be sent", async () => {
      // The applicant already did their part; a failed courtesy mail must not
      // be reported to them as a failed application.
      const { response, mails } = await submitWithMail(complete, 500);
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ ok: true, invited: false });
      expect(mails).toHaveLength(1);
    });
  });
});
