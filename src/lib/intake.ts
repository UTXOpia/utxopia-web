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

export async function deliver({
  entry,
  human,
  subject,
  replyTo,
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
  webhook?: string;
  logPath?: string;
  email?: EmailSink;
}): Promise<{ delivered: boolean; errors: string[] }> {
  const errors: string[] = [];
  let delivered = false;

  if (email) {
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${email.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          from: email.from,
          to: email.to,
          subject,
          // `human` is formatted for Discord/Slack. Asterisks that render as
          // bold there are just noise in a mail client, and a message full of
          // stray markup is one more thing for a spam filter to dislike.
          text: human.replace(/\*\*/g, ""),
          ...(replyTo ? { reply_to: replyTo } : {}),
        }),
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
