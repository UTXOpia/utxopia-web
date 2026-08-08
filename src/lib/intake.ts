/**
 * Shared plumbing for the beta's two unauthenticated intake forms — feedback
 * and applications.
 *
 * Both take an email address from a stranger and forward it to a chat webhook,
 * and both must stay clear of wallet and vault state. Keeping the delivery and
 * the field-cleaning in one place is what makes "unknown fields are dropped"
 * something each route can enforce in three lines instead of re-deriving.
 *
 * Three sinks, any one of which is enough: email (Resend), a chat webhook
 * (Discord/Slack), or a JSONL file. Email is the one that needs no third-party
 * chat account and puts intake in the same place the reply comes from — which
 * for an application *is* how the code goes out. The JSONL sink does not
 * survive on Vercel; its filesystem is ephemeral.
 *
 * Sinks are per-form with a shared fallback (see each route), so one webhook
 * covers both until there is a reason to split them.
 */

import { appendFile } from "node:fs/promises";

export function clean(value: unknown, max: number): string {
  return typeof value === "string" ? value.trim().slice(0, max) : "";
}

/** Deliberately loose. A typo'd address is the sender's problem; a regex that
 *  rejects a valid one costs us the only reply channel they offered. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export function clientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  return forwarded?.split(",")[0]?.trim() || req.headers.get("x-real-ip") || "unknown";
}

/**
 * Per-form limiter. In-memory and per serverless instance, so it thins out
 * accidents and casual spray, not anything determined — which is the right
 * bar at beta size, but do not mistake it for abuse protection.
 */
export function createRateLimiter({ windowMs, max }: { windowMs: number; max: number }) {
  const recent = new Map<string, number[]>();

  return function rateLimited(ip: string): boolean {
    const now = Date.now();
    const hits = (recent.get(ip) ?? []).filter((t) => now - t < windowMs);
    hits.push(now);
    recent.set(ip, hits);
    // A warm instance should not accumulate dead IPs for a week.
    if (recent.size > 5000) {
      for (const [key, times] of recent) {
        if (times.every((t) => now - t >= windowMs)) recent.delete(key);
      }
    }
    return hits.length > max;
  };
}

export interface EmailSink {
  apiKey: string;
  to: string[];
  from: string;
}

/** The product's accent (`--privacy-purple` in styles/base.css). Hard-coded
 *  because mail has no access to CSS variables. */
const BRAND_PURPLE = "#9945ff";

/** Absolute, because a mail client has no origin to resolve against. Override
 *  only if the logo moves; a localhost URL here reaches nobody. */
const BRAND_LOGO_URL =
  process.env.INTAKE_EMAIL_LOGO_URL || "https://app.utxopia.com/brand/logo-transparent-96.png";

export interface EmailRow {
  label: string;
  /** Rendered as plain text — newlines are preserved, markup is not. */
  value: string;
  /** Stack the value under its label instead of beside it. For prose. */
  block?: boolean;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * A plain, professional intake mail.
 *
 * Written to the subset of HTML that mail clients agree on: tables for layout,
 * inline styles only, no <style> block (Gmail strips it in some views), no web
 * fonts, no images. It renders the same in Gmail, Apple Mail and Outlook, and
 * degrades to something readable anywhere else.
 *
 * Light background on purpose. A dark template inverts unpredictably across
 * clients — including into unreadable — and intake mail is read once, quickly,
 * in whatever the reader already had open.
 */
export function renderIntakeEmail({
  title,
  badges = [],
  intro = [],
  rows = [],
  meta = [],
}: {
  title: string;
  badges?: string[];
  /** Prose paragraphs, before any rows. A message to a person rather than a
   *  record about one. */
  intro?: string[];
  rows?: EmailRow[];
  meta?: string[];
}): string {
  const badgeHtml = badges.length
    ? `<tr><td style="padding:0 0 18px 0;">${badges
        .map(
          (badge) =>
            `<span style="display:inline-block;margin:0 6px 6px 0;padding:4px 10px;border-radius:999px;` +
            `background:#f3ecff;color:#5b21b6;font-size:12px;font-weight:600;">${escapeHtml(badge)}</span>`,
        )
        .join("")}</td></tr>`
    : "";

  const introHtml = intro
    .map(
      (paragraph, index) =>
        // The title sits tight above; the first paragraph buys back the gap.
        `<tr><td style="padding:${index === 0 ? "10px" : "0"} 0 12px 0;` +
        `font-size:14px;line-height:1.65;color:#374151;">` +
        `${escapeHtml(paragraph)}</td></tr>`,
    )
    .join("");

  const rowHtml = rows
    .map(({ label, value, block }) => {
      const body = escapeHtml(value || "—").replace(/\n/g, "<br>");
      const labelCell =
        `<div style="font-size:12px;font-weight:600;letter-spacing:.04em;text-transform:uppercase;` +
        `color:#6b7280;">${escapeHtml(label)}</div>`;
      const valueCell = `<div style="font-size:14px;line-height:1.6;color:#111827;">${body}</div>`;
      return (
        `<tr><td style="padding:12px 0;border-top:1px solid #e5e7eb;">` +
        (block ? `${labelCell}<div style="height:6px;"></div>${valueCell}` : `${labelCell}${valueCell}`) +
        `</td></tr>`
      );
    })
    .join("");

  const metaHtml = meta.length
    ? `<tr><td style="padding:18px 0 0 0;border-top:1px solid #e5e7eb;font-size:12px;line-height:1.7;color:#9ca3af;">` +
      meta.map(escapeHtml).join("<br>") +
      `</td></tr>`
    : "";

  const font =
    "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

  return [
    `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#f6f7f9;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">`,
    `<tr><td align="center">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="600"`,
    ` style="max-width:600px;width:100%;background:#ffffff;border:1px solid #e5e7eb;`,
    `border-radius:12px;overflow:hidden;font-family:${font};">`,
    // Brand bar: logo *and* wordmark, on a coloured band.
    //
    // Gmail, Apple Mail and Outlook.com all load remote images by default now;
    // Outlook on Windows still asks first. The band and the wordmark are what
    // survive that, so the header reads as ours either way and the layout does
    // not move — which is why the image carries alt="" rather than "UTXOpia":
    // with the wordmark beside it, alt text would just print the name twice.
    `<tr><td style="background:${BRAND_PURPLE};padding:12px 28px;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0"><tr>`,
    `<td style="padding-right:9px;vertical-align:middle;line-height:0;">`,
    `<img src="${BRAND_LOGO_URL}" width="22" height="22" alt=""`,
    ` style="display:block;width:22px;height:22px;border:0;outline:none;"></td>`,
    `<td style="vertical-align:middle;">`,
    `<span style="font-size:13px;font-weight:700;letter-spacing:.12em;color:#ffffff;">UTXOPIA</span>`,
    `</td></tr></table>`,
    `</td></tr>`,
    `<tr><td style="padding:26px 28px 28px 28px;">`,
    `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%">`,
    `<tr><td style="padding:0 0 4px 0;font-size:18px;font-weight:700;color:#111827;">${escapeHtml(title)}</td></tr>`,
    badgeHtml,
    introHtml,
    rowHtml,
    metaHtml,
    `</table></td></tr>`,
    `</table></td></tr></table></body></html>`,
  ].join("");
}

/**
 * Configured only when both halves are present — an API key with nowhere to
 * send is not a sink, and treating it as one turns "no sink" into a 502.
 *
 * `INTAKE_EMAIL_TO` accepts a comma-separated list so intake can reach a shared
 * address and a personal one at the same time. Worth knowing before you add
 * one: a recipient that does not actually receive (a domain address with no
 * routing rule behind it) bounces silently, and bounces cost sender reputation
 * on a young domain. Add the second address, do not swap to it, until you have
 * seen mail arrive there.
 */
export function emailSink(): EmailSink | undefined {
  const apiKey = process.env.RESEND_API_KEY;
  const to = (process.env.INTAKE_EMAIL_TO ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (!apiKey || to.length === 0) return undefined;
  return { apiKey, to, from: process.env.INTAKE_EMAIL_FROM || "onboarding@resend.dev" };
}

/** One Resend call. Returns the raw Response so callers decide what a failure
 *  means — for intake it is fatal, for a courtesy mail it is not. */
export async function sendEmail({
  sink,
  to,
  subject,
  text,
  html,
  replyTo,
}: {
  sink: EmailSink;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  replyTo?: string | null;
}): Promise<Response> {
  return fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${sink.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      from: sink.from,
      to,
      subject,
      text,
      ...(html ? { html } : {}),
      ...(replyTo ? { reply_to: replyTo } : {}),
    }),
  });
}

export async function deliver({
  entry,
  human,
  subject,
  replyTo,
  html,
  webhook,
  logPath,
  email,
}: {
  entry: unknown;
  human: string;
  subject: string;
  /** The sender's own address, so replying in the inbox reaches them. For
   *  applications that reply *is* how a code goes out. */
  replyTo?: string | null;
  /** Optional HTML body. The text part is always sent alongside it: a mail with
   *  no text alternative scores worse with spam filters, and some clients still
   *  show it. */
  html?: string;
  webhook?: string;
  logPath?: string;
  email?: EmailSink;
}): Promise<{ delivered: boolean; errors: string[] }> {
  const errors: string[] = [];
  let delivered = false;

  if (email) {
    try {
      const res = await sendEmail({
        sink: email,
        to: email.to,
        subject,
        // `human` is formatted for Discord/Slack. Asterisks that render as
        // bold there are just noise in a mail client, and a message full of
        // stray markup is one more thing for a spam filter to dislike.
        text: human.replace(/\*\*/g, ""),
        html,
        replyTo,
      });
      if (res.ok) delivered = true;
      else errors.push(`email ${res.status}: ${(await res.text()).slice(0, 200)}`);
    } catch (e) {
      errors.push(`email: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  if (webhook) {
    try {
      const res = await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // `content` is Discord, `text` is Slack, the structured field is for
        // anything that wants the parsed version. One payload satisfies all.
        body: JSON.stringify({ content: human, text: human, entry }),
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
