/**
 * POST /api/apply — closed-beta applications.
 *
 * An email, why they are interested, and two opt-ins. The five screening
 * questions this used to carry moved into the conversation the feedback opt-in
 * asks for: a long form in front of a stranger screens for patience, and the
 * answers it did collect were worth less than ten minutes on a call.
 *
 * This route only records answers — it never issues a
 * code. Auto-issuing on an email would give away the two things scarcity buys:
 * screening (most applications are meant to get a no) and a cohort that lands
 * inside one 48-hour window instead of trickling in, near-self-identifying, on
 * chain. `invite.rs` redeem() checks a code and a wallet signature and nothing
 * else, so anyone holding a code is in, permanently.
 *
 * Unlike feedback this form *is* identity — an email and how someone describes
 * themselves — so it stays as far from the vault as the code allows: no wallet,
 * no balances, no notes, unknown fields dropped.
 *
 * Any one sink is enough. The webhook and file ones fall back to the feedback
 * variables, so a single setting covers both forms:
 *   RESEND_API_KEY + INTAKE_EMAIL_TO    (shared)
 *
 * With mail configured a submission sends two: the application to intake, with
 * the applicant as reply-to, and a receipt to the applicant, with intake as
 * reply-to. The receipt is best-effort and never fails the request.
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
  renderIntakeEmail,
  sendEmail,
} from "@/lib/intake";
import { cleanApplyRoles } from "@/lib/apply-roles";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_EMAIL = 254;
const MAX_LONG = 2000;
const MAX_CONTEXT = 200;

const rateLimited = createRateLimiter({ windowMs: 10 * 60 * 1000, max: 3 });

interface Application {
  received_at: string;
  email: string;
  roles: string[];
  reason: string;
  email_opt_in: boolean;
  feedback_opt_in: boolean;
  network: string;
  user_agent: string;
}

function formatForHuman(a: Application): string {
  return [
    `**beta application** — ${a.email}${a.feedback_opt_in ? "  ·  up for a 1-on-1" : ""}`,
    "",
    `**They are:** ${a.roles.join(", ") || "—"}`,
    "",
    `**Why they're interested:** ${a.reason}`,
    "",
    `updates: ${a.email_opt_in ? "yes" : "no"}   1-on-1: ${a.feedback_opt_in ? "yes" : "no"}`,
    `network: ${a.network || "—"}`,
    `at: ${a.received_at}`,
  ].join("\n");
}

/** The same application as mail. Badges carry what decides whether it gets
 *  opened now: the self-description, and whether they offered a call. */
function formatAsEmail(a: Application): string {
  return renderIntakeEmail({
    title: "New beta application",
    badges: [
      ...a.roles,
      ...(a.feedback_opt_in ? ["Up for a 1-on-1"] : []),
      ...(a.email_opt_in ? ["Wants updates"] : []),
    ],
    rows: [
      { label: "Email", value: a.email },
      { label: "Best describes them", value: a.roles.join(" · ") },
      { label: "Why they're interested", value: a.reason, block: true },
    ],
    meta: [
      `Network: ${a.network || "—"}`,
      `Received: ${a.received_at}`,
      "Reply to this mail to reach the applicant — that reply is how a code goes out.",
    ],
  });
}

/**
 * The receipt the applicant gets.
 *
 * It repeats nothing they typed. That is a security property, not an
 * oversight: this endpoint is unauthenticated and will send mail to whatever
 * address it is handed, so echoing their free text back would turn it into a
 * way to deliver arbitrary content to an arbitrary inbox, over our domain and
 * our sender reputation. Everything here is fixed copy.
 *
 * The one thing it must land is how a code arrives — a human reply to this
 * thread — because "you have a code, click here" is the phishing mail someone
 * will eventually send in our name, and a person who knows what to expect is
 * the only defence that scales.
 */
function confirmationEmail(): { subject: string; html: string; text: string } {
  const lines = [
    "Thanks — your application is in, and a person will read it.",
    "That usually takes a couple of days. Most applications get a no, and it is not personal: every admission writes a permanent entry on chain that nobody can remove, so the cohort stays small on purpose.",
    "If we do send an invite code, it comes as a reply to this thread, from a person. Never from a link in a post, never automatically, and never from anyone asking you to connect a wallet to claim it. If you get one that does, it is not us.",
    "Nothing about a wallet is attached to your application — no address, no balances.",
  ];
  return {
    subject: "We got your UTXOpia application",
    text: `${lines.join("\n\n")}\n\nUTXOpia`,
    html: renderIntakeEmail({ title: "Your application is in", intro: lines }),
  };
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

  // The one question left has to be answered, or the form collects addresses
  // and nothing else.
  const reason = clean(body.reason, MAX_LONG);
  if (reason.length < 2) {
    return NextResponse.json(
      { ok: false, error: "tell us why you're interested — a couple of sentences is plenty" },
      { status: 400 },
    );
  }

  const application: Application = {
    received_at: new Date().toISOString(),
    email,
    roles: cleanApplyRoles(body.roles),
    reason,
    // Consent is opt-in: anything that is not an explicit `true` is a no.
    email_opt_in: body.emailOptIn === true,
    feedback_opt_in: body.feedbackOptIn === true,
    network: clean(body.network, MAX_CONTEXT),
    user_agent: clean(req.headers.get("user-agent"), MAX_CONTEXT),
  };

  const { delivered, errors } = await deliver({
    entry: application,
    human: formatForHuman(application),
    html: formatAsEmail(application),
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

  // Courtesy receipt, sent only once the application is safely recorded and
  // deliberately not allowed to fail the request: the applicant has already
  // done their part, and telling them it went wrong when it did not would cost
  // us a second submission and them the belief that it works. Replies go to
  // the intake inbox, which is the thread a code would arrive on.
  if (mail) {
    try {
      const receipt = confirmationEmail();
      const res = await sendEmail({
        sink: mail,
        to: [email],
        subject: receipt.subject,
        text: receipt.text,
        html: receipt.html,
        replyTo: mail.to[0],
      });
      if (!res.ok) {
        console.warn("[apply] confirmation not sent", res.status, await res.text());
      }
    } catch (caught) {
      console.warn("[apply] confirmation not sent", caught);
    }
  }

  return NextResponse.json({ ok: true });
}
