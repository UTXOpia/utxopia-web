/**
 * POST /api/apply — closed-beta applications.
 *
 * An email, why they are interested, and two opt-ins. The five screening
 * questions this used to carry moved into the conversation the feedback opt-in
 * asks for: a long form in front of a stranger screens for patience, and the
 * answers it did collect were worth less than ten minutes on a call.
 *
 * This route records the answers and, when auto-issue is configured, mints a
 * code and mails it on the spot. That reverses the position this file used to
 * argue: scarcity bought screening and a cohort that landed inside one window,
 * and both were worth paying for — but not with a two-day wait for admission to
 * a devnet with no real money in it, which is what the delay actually costs
 * now. `invite.rs` redeem() still checks a code and a wallet signature and
 * nothing else, so anyone holding a code is in, permanently; the thing that
 * keeps that bounded here is the rate limiter and nothing else.
 *
 * Auto-issue is opt-in and fails closed: no UTXOPIA_INVITE_ADMIN_KEY, or a mint
 * that errors, and the applicant gets the review receipt instead. See
 * `lib/server/invite-issue.ts`.
 *
 * Unlike feedback this form *is* identity — an email and how someone describes
 * themselves — so it stays as far from the vault as the code allows: no wallet,
 * no balances, no notes, unknown fields dropped.
 *
 * Every submission is also written to the invite DB, which is what /admin/
 * applications reads. That write is best-effort and happens after delivery —
 * see `lib/server/applications.ts`.
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
import { autoInviteEnabled, inviteEmail, mintInvite } from "@/lib/server/invite-issue";
import { recordApplication } from "@/lib/server/applications";

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
    `**Beta application** — ${a.email}${a.feedback_opt_in ? "  ·  up for a 1-on-1" : ""}`,
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
function formatAsEmail(a: Application, autoIssued: boolean): string {
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
      autoIssued
        ? "A code was minted and mailed automatically. Reply to this mail to reach the applicant."
        : "No code went out — reply to this mail to reach the applicant, and that reply is how one goes.",
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
 * Sent only when auto-issue is off or the mint failed — otherwise the applicant
 * gets `inviteEmail` instead, and this is the apology for the delay.
 *
 * The one thing both of them must land is where a code comes from: mail from
 * us, never a link in a post and never a wallet connection. "You have a code,
 * click here" is the phishing mail someone will eventually send in our name,
 * and a person who knows what to expect is the only defence that scales.
 */
function confirmationEmail(): { subject: string; html: string; text: string } {
  const lines = [
    "Codes usually go out the moment you apply. Yours needs a person, so give it a day. Nothing went wrong on your end.",
    "It will arrive as a reply to this email. Never from a link in a post, and never from anyone asking you to connect a wallet to claim it — if you get one of those, it is not us.",
    "No wallet is attached to your application: no address, no balances.",
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

  // Minted before the application is recorded, so intake mail can say truthfully
  // whether a code went out. A code with no record behind it is the cheaper
  // failure: it is in the invite ledger under this email either way.
  const invite = autoInviteEnabled() ? await mintInvite(application.email) : null;

  const { delivered, errors } = await deliver({
    entry: application,
    human: formatForHuman(application),
    html: formatAsEmail(application, Boolean(invite)),
    subject: `Beta application — ${application.email}`,
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

  // Stored after delivery, for the same reason the receipt is: intake already
  // has it, so a backend that is down costs a row and not the submission.
  await recordApplication({
    email: application.email,
    roles: application.roles,
    reason: application.reason,
    emailOptIn: application.email_opt_in,
    feedbackOptIn: application.feedback_opt_in,
    network: application.network,
    invited: Boolean(invite),
  });

  // The invite, or the receipt that stands in for it. Sent only once the
  // application is safely recorded and deliberately not allowed to fail the
  // request: the applicant has already done their part, and telling them it
  // went wrong when it did not would cost us a second submission and them the
  // belief that it works. Replies go to the intake inbox either way.
  if (mail) {
    try {
      const outgoing = invite ? inviteEmail(invite) : confirmationEmail();
      const res = await sendEmail({
        sink: mail,
        to: [email],
        subject: outgoing.subject,
        text: outgoing.text,
        html: outgoing.html,
        replyTo: mail.to[0],
      });
      if (!res.ok) {
        // The code is already minted and cannot be un-minted. Log the plaintext
        // so it can be sent by hand rather than expiring unused in the ledger —
        // this is the one place it exists outside that mail.
        console.warn("[apply] confirmation not sent", res.status, await res.text());
        if (invite) console.warn("[apply] unsent code for", email, invite.code);
      }
    } catch (caught) {
      console.warn("[apply] confirmation not sent", caught);
      if (invite) console.warn("[apply] unsent code for", email, invite.code);
    }
  }

  return NextResponse.json({ ok: true, invited: Boolean(invite) });
}
