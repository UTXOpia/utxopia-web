/**
 * POST /api/apply — closed-beta applications.
 *
 * The five questions are `launch/OUTREACH.md`; each earns its place and none
 * of them is a formality. This route only records answers — it never issues a
 * code. Auto-issuing on an email would give away the two things scarcity buys:
 * screening (most applications are meant to get a no) and a cohort that lands
 * inside one 48-hour window instead of trickling in, near-self-identifying, on
 * chain. `invite.rs` redeem() checks a code and a wallet signature and nothing
 * else, so anyone holding a code is in, permanently.
 *
 * Unlike feedback this form *is* identity — an email and links to a person's
 * work — so it stays as far from the vault as the code allows: no wallet, no
 * balances, no notes, unknown fields dropped.
 *
 * Any one sink is enough. The webhook and file ones fall back to the feedback
 * variables, so a single setting covers both forms:
 *   RESEND_API_KEY + INTAKE_EMAIL_TO    (shared; replies go to the applicant)
 *   APPLY_WEBHOOK_URL || FEEDBACK_WEBHOOK_URL
 *   APPLY_LOG_PATH    || FEEDBACK_LOG_PATH
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

const MAX_EMAIL = 254;
const MAX_SHORT = 500;
const MAX_LONG = 2000;
const MAX_CONTEXT = 200;

const rateLimited = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 3 });

interface Application {
  received_at: string;
  email: string;
  who: string;
  use_case: string;
  cli_ok: boolean;
  background: string;
  distrust: string;
  source: string;
  network: string;
  user_agent: string;
}

function formatForHuman(a: Application): string {
  return [
    `**beta application** — ${a.email}${a.cli_ok ? "" : "  ·  ⚠️ won't run CLI scripts"}`,
    "",
    `**Who:** ${a.who}`,
    "",
    `**Would move:** ${a.use_case}`,
    "",
    `**Background:** ${a.background || "— (blank)"}`,
    "",
    `**Would stop trusting us if:** ${a.distrust}`,
    "",
    `heard via: ${a.source || "—"}   network: ${a.network || "—"}`,
    `at: ${a.received_at}`,
  ].join("\n");
}

export async function POST(req: Request) {
  const webhook = process.env.APPLY_WEBHOOK_URL || process.env.FEEDBACK_WEBHOOK_URL;
  const logPath = process.env.APPLY_LOG_PATH || process.env.FEEDBACK_LOG_PATH;
  const mail = emailSink();
  if (!mail && !webhook && !logPath) {
    return NextResponse.json(
      { ok: false, error: "applications are not open right now" },
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

  const email = clean(body.email, MAX_EMAIL);
  if (!email || !looksLikeEmail(email)) {
    return NextResponse.json(
      { ok: false, error: "we need an email we can send a code to" },
      { status: 400 },
    );
  }

  const who = clean(body.who, MAX_SHORT);
  const useCase = clean(body.useCase, MAX_LONG);
  const distrust = clean(body.distrust, MAX_LONG);

  // `distrust` is the question that pays back — a blank there is the
  // application telling you it was filled in to collect something.
  const missing =
    who.length < 2 ? "tell us who you are — a link is enough"
    : useCase.length < 2 ? "tell us what you would move through this"
    : distrust.length < 2 ? "the last question is the one we most want answered"
    : null;
  if (missing) return NextResponse.json({ ok: false, error: missing }, { status: 400 });

  if (typeof body.cliOk !== "boolean") {
    return NextResponse.json(
      { ok: false, error: "let us know whether you can run a CLI script" },
      { status: 400 },
    );
  }

  const application: Application = {
    received_at: new Date().toISOString(),
    email,
    who,
    use_case: useCase,
    cli_ok: body.cliOk,
    background: clean(body.background, MAX_LONG),
    distrust,
    source: clean(body.source, MAX_SHORT),
    network: clean(body.network, MAX_CONTEXT),
    user_agent: clean(req.headers.get("user-agent"), MAX_CONTEXT),
  };

  const { delivered, errors } = await deliver({
    entry: application,
    human: formatForHuman(application),
    subject: `beta application — ${application.email}`,
    replyTo: application.email,
    webhook,
    logPath,
    email: mail,
  });
  if (!delivered) {
    console.error("[apply] every sink failed", errors, application);
    return NextResponse.json(
      { ok: false, error: "could not record your application — please email us instead" },
      { status: 502 },
    );
  }
  if (errors.length) console.warn("[apply] partial delivery", errors);

  return NextResponse.json({ ok: true });
}
