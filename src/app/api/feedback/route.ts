/**
 * POST /api/feedback — beta feedback intake.
 *
 * Phase 1–2 of the beta take everything (`BETA-LAUNCH-PLAYBOOK.md`, pre-flight
 * item 5): a plain form, no signature, no wallet. That is deliberate — a bug
 * report that costs a signature is a bug report you do not get.
 *
 * What this route will *not* do is attach identity. The client sends only what
 * the member typed plus the page they were on; there is no wallet address, no
 * note data, no address book. On a privacy product an intake form that quietly
 * fingerprints the reporter is worse than no form, so the absence is enforced
 * here rather than trusted to the caller: unknown fields are dropped.
 *
 * Sinks, in order of preference, both optional but at least one required:
 *   FEEDBACK_WEBHOOK_URL — Discord/Slack-compatible incoming webhook.
 *   FEEDBACK_LOG_PATH    — JSONL append, for self-hosted or local runs.
 *
 * With neither set the route fails loudly (503). Silently accepting feedback
 * into nowhere is the one outcome worse than the form being down, because the
 * member believes they were heard and the email address is gone.
 */

import { NextResponse } from "next/server";
import { appendFile } from "node:fs/promises";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MESSAGE = 4000;
const MAX_EMAIL = 254;
const MAX_CONTEXT = 200;

const KINDS = new Set(["bug", "confusing", "idea", "other"]);

const WINDOW_MS = 10 * 60 * 1000;
const MAX_PER_WINDOW = 5;
const recent = new Map<string, number[]>();

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const hits = (recent.get(ip) ?? []).filter((t) => now - t < WINDOW_MS);
  hits.push(now);
  recent.set(ip, hits);
  // Bounded cleanup: this map is per-instance and beta-sized, but a serverless
  // instance that stays warm for a week should not accumulate dead IPs.
  if (recent.size > 5000) {
    for (const [key, times] of recent) {
      if (times.every((t) => now - t >= WINDOW_MS)) recent.delete(key);
    }
  }
  return hits.length > MAX_PER_WINDOW;
}

function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Deliberately loose. A typo'd address is the member's problem; a regex that
 *  rejects a valid one costs us the only reply channel they offered. */
function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

interface Entry {
  received_at: string;
  kind: string;
  message: string;
  email: string | null;
  wants_session: boolean;
  page: string;
  network: string;
  user_agent: string;
}

function formatForHuman(entry: Entry): string {
  const lines = [
    `**beta feedback — ${entry.kind}**${entry.wants_session ? "  ·  🗣️ wants a 1-on-1" : ""}`,
    "",
    entry.message,
    "",
    `contact: ${entry.email ?? "— (none given)"}`,
    `page: ${entry.page || "—"}   network: ${entry.network || "—"}`,
    `at: ${entry.received_at}`,
  ];
  return lines.join("\n");
}

async function deliver(entry: Entry): Promise<{ delivered: boolean; errors: string[] }> {
  const webhook = process.env.FEEDBACK_WEBHOOK_URL;
  const logPath = process.env.FEEDBACK_LOG_PATH;
  const errors: string[] = [];
  let delivered = false;

  if (webhook) {
    const human = formatForHuman(entry);
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `content` is Discord, `text` is Slack, `feedback` is anything that
        // wants the structured version. One payload satisfies all three.
        body: JSON.stringify({ content: human, text: human, feedback: entry }),
      });
      if (res.ok) delivered = true;
      else errors.push(`webhook ${res.status}`);
    } catch (e) {
      errors.push(`webhook: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (logPath) {
    try {
      await appendFile(logPath, `${JSON.stringify(entry)}\n`, "utf8");
      delivered = true;
    } catch (e) {
      errors.push(`log: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  return { delivered, errors };
}

export async function POST(req: Request) {
  if (!process.env.FEEDBACK_WEBHOOK_URL && !process.env.FEEDBACK_LOG_PATH) {
    return NextResponse.json(
      { ok: false, error: "feedback intake is not configured" },
      { status: 503 },
    );
  }

  if (rateLimited(clientIp(req))) {
    return NextResponse.json(
      { ok: false, error: "too many submissions — try again in a few minutes" },
      { status: 429 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const message = clean(body.message, MAX_MESSAGE);
  if (message.length < 2) {
    return NextResponse.json({ ok: false, error: "message is required" }, { status: 400 });
  }

  const email = clean(body.email, MAX_EMAIL);
  if (email && !looksLikeEmail(email)) {
    return NextResponse.json({ ok: false, error: "that email does not look valid" }, { status: 400 });
  }

  const wantsSession = body.wantsSession === true;
  if (wantsSession && !email) {
    return NextResponse.json(
      { ok: false, error: "a 1-on-1 needs an email to reach you at" },
      { status: 400 },
    );
  }

  const kindRaw = clean(body.kind, 20).toLowerCase();
  const entry: Entry = {
    received_at: new Date().toISOString(),
    kind: KINDS.has(kindRaw) ? kindRaw : "other",
    message,
    email: email || null,
    wants_session: wantsSession,
    page: clean(body.page, MAX_CONTEXT),
    network: clean(body.network, MAX_CONTEXT),
    user_agent: clean(req.headers.get("user-agent"), MAX_CONTEXT),
  };

  const { delivered, errors } = await deliver(entry);
  if (!delivered) {
    console.error("[feedback] every sink failed", errors, entry);
    return NextResponse.json(
      { ok: false, error: "could not deliver your feedback — please email us instead" },
      { status: 502 },
    );
  }
  if (errors.length) console.warn("[feedback] partial delivery", errors);

  return NextResponse.json({ ok: true });
}
