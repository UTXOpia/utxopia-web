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
 * Sinks, all optional but at least one required:
 *   RESEND_API_KEY + INTAKE_EMAIL_TO — email, shared with /api/apply.
 *   FEEDBACK_WEBHOOK_URL             — Discord/Slack-compatible incoming webhook.
 *   FEEDBACK_LOG_PATH                — JSONL append, for self-hosted or local runs.
 *
 * With none set the route fails loudly (503). Silently accepting feedback
 * into nowhere is the one outcome worse than the form being down, because the
 * member believes they were heard and the email address is gone.
 */

import { NextResponse } from "next/server";
import {
  clean,
  clientIp,
  createRateLimiter,
  deliver,
  emailSink,
  looksLikeEmail,
} from "@/lib/intake";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_MESSAGE = 4000;
const MAX_EMAIL = 254;
const MAX_CONTEXT = 200;

const KINDS = new Set(["bug", "confusing", "idea", "other"]);

const rateLimited = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 5 });

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
  return [
    `**beta feedback — ${entry.kind}**${entry.wants_session ? "  ·  🗣️ wants a 1-on-1" : ""}`,
    "",
    entry.message,
    "",
    `contact: ${entry.email ?? "— (none given)"}`,
    `page: ${entry.page || "—"}   network: ${entry.network || "—"}`,
    `at: ${entry.received_at}`,
  ].join("\n");
}

export async function POST(req: Request) {
  const webhook = process.env.FEEDBACK_WEBHOOK_URL;
  const logPath = process.env.FEEDBACK_LOG_PATH;
  const mail = emailSink();
  if (!mail && !webhook && !logPath) {
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

  const { delivered, errors } = await deliver({
    entry,
    human: formatForHuman(entry),
    subject: `beta feedback — ${entry.kind}${entry.wants_session ? " · wants a 1-on-1" : ""}`,
    replyTo: entry.email,
    webhook,
    logPath,
    email: mail,
  });
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
