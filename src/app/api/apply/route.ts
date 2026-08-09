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
 * The record of a submission is the row in the invite DB, read back at
 * /admin/applications. The operator no longer gets a copy by mail: a page is a
 * better place to read these than an inbox, and the copy doubled the mail sent
 * per application. On a metered tier that is not free — the second mail is the
 * one that pushes the *first* over a limit, and the first carries the code.
 *
 * So exactly one mail goes out per application, to the applicant: the invite,
 * or the receipt that stands in when no code could be issued.
 *
 *   RESEND_API_KEY + INTAKE_EMAIL_TO    what that mail is sent with; INTAKE_
 *                                       EMAIL_TO is its reply-to, not a
 *                                       recipient
 *   APPLY_WEBHOOK_URL || FEEDBACK_WEBHOOK_URL   optional extras, for a channel
 *   APPLY_LOG_PATH    || FEEDBACK_LOG_PATH      that wants a push
 *
 * The store is what decides whether applications are open at all: with no
 * database and no webhook, a submission has nowhere to go and the route says so
 * rather than mailing a code it keeps no record of.
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
import { applicationStoreConfigured, recordApplication } from "@/lib/server/applications";

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
  // The database counts as a sink now, and is the one that normally answers.
  // Mail alone no longer qualifies: it only carries the applicant's copy, so a
  // deployment with mail and nothing else would send codes it kept no record of.
  if (!applicationStoreConfigured() && !webhook && !logPath) {
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

  const invite = autoInviteEnabled() ? await mintInvite(application.email) : null;

  // The one mail this route sends, and it goes to the applicant. The operator's
  // copy used to go out beside it and does not any more: /admin/applications is
  // a better place to read these than an inbox, and the copy was costing half
  // the sending quota — on the tier this runs on, the invite is what runs out.
  //
  // Sent before the row is written so `invited` can mean what it says. A code
  // that was minted but never reached anyone is not an admission, and recording
  // it as one hides the only failure here worth acting on.
  let sent = false;
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
      sent = res.ok;
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

  const invited = Boolean(invite) && sent;
  const stored = await recordApplication({
    email: application.email,
    roles: application.roles,
    reason: application.reason,
    emailOptIn: application.email_opt_in,
    feedbackOptIn: application.feedback_opt_in,
    network: application.network,
    invited,
  });

  // Webhook and log file are extras now, not the primary record — pass no email
  // sink, or the operator copy this change removed comes straight back.
  const { delivered, errors } = await deliver({
    entry: application,
    human: formatForHuman(application),
    subject: `Beta application — ${application.email}`,
    replyTo: application.email,
    webhook,
    logPath,
  });
  if (errors.length) console.warn("[apply] partial delivery", errors);

  // Only a submission that reached nobody and nothing is a failure. If the mail
  // went out, the applicant has their code and telling them it broke would earn
  // us a resubmission and them a second code they cannot use.
  if (!stored && !delivered && !sent) {
    console.error("[apply] every sink failed", errors, application);
    return NextResponse.json(
      { ok: false, error: "could not record your application — please email us instead" },
      { status: 502 },
    );
  }
  if (!stored) console.warn("[apply] not stored, but delivered elsewhere", application.email);

  return NextResponse.json({ ok: true, invited });
}
