"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useChainEnvironment } from "@/lib/chain-environment";
import { cn } from "@/lib/utils";

type Kind = "bug" | "confusing" | "idea" | "other";
type Status = "idle" | "sending" | "done" | "error";

const KINDS: { value: Kind; label: string }[] = [
  { value: "bug", label: "Something broke" },
  { value: "confusing", label: "Confusing" },
  { value: "idea", label: "Idea" },
  { value: "other", label: "Other" },
];

export const FEEDBACK_EMAIL = process.env.NEXT_PUBLIC_FEEDBACK_EMAIL || "beta@utxopia.com";

const inputClass = cn(
  "min-h-10 w-full rounded-[10px] border border-gray/20 bg-transparent px-3 py-2",
  "text-caption text-foreground placeholder:text-gray",
  "focus:border-gray/40 focus:outline-none disabled:opacity-60",
);

/**
 * Beta feedback intake.
 *
 * Three things a member can give us, in descending order of how many of them
 * will give it: what went wrong, an email, and their time. Asking for all three
 * at once would suppress the first, so only the message is required and each
 * later ask is visibly optional.
 *
 * Nothing is read from the vault. The only context attached is the page and the
 * network — see `api/feedback/route.ts`, which drops anything else.
 */
export function FeedbackForm({
  className,
  onDone,
}: {
  className?: string;
  onDone?: () => void;
}) {
  const pathname = usePathname();
  const { networkId } = useChainEnvironment();

  const [kind, setKind] = useState<Kind>("bug");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [wantsSession, setWantsSession] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = status === "sending";
  const ready = message.trim().length > 1 && !busy && (!wantsSession || email.trim().length > 0);

  const submit = async () => {
    setError(null);
    setStatus("sending");
    try {
      const response = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          message: message.trim(),
          email: email.trim() || undefined,
          wantsSession,
          page: pathname,
          network: networkId,
        }),
      });
      const parsed = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          typeof parsed?.error === "string" ? parsed.error : `failed (${response.status})`,
        );
      }
      setStatus("done");
      onDone?.();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not send that");
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div className={cn("flex flex-col gap-3", className)} role="status">
        <div className="flex items-start gap-2 rounded-[10px] border border-privacy/25 bg-privacy/10 px-3 py-2.5">
          <Check className="mt-0.5 h-4 w-4 shrink-0 text-privacy" aria-hidden />
          <span className="text-caption text-gray-light">
            <strong className="text-foreground">Got it — thank you.</strong>{" "}
            {wantsSession
              ? "We'll email you to book the 20 minutes, usually within a day or two."
              : email
                ? "We'll reply if there's anything to say back."
                : "You left no email, so treat this as sent into the void — a good void, but a quiet one."}
          </span>
        </div>
        <button
          type="button"
          onClick={() => {
            setMessage("");
            setWantsSession(false);
            setStatus("idle");
          }}
          className="self-start text-caption text-gray underline underline-offset-4 hover:text-foreground"
        >
          Send another
        </button>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="flex flex-wrap gap-1.5">
        {KINDS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setKind(option.value)}
            disabled={busy}
            className={cn(
              "rounded-full border px-3 py-1 text-caption transition-colors",
              kind === option.value
                ? "border-privacy/40 bg-privacy/10 text-foreground"
                : "border-gray/20 text-gray hover:border-gray/40 hover:text-gray-light",
            )}
          >
            {option.label}
          </button>
        ))}
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-caption text-gray-light">
          What happened? {kind === "bug" && <span className="text-gray">— what you did, what you expected, what you saw</span>}
        </span>
        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          rows={5}
          maxLength={4000}
          disabled={busy}
          placeholder={
            kind === "bug"
              ? "I tried to withdraw 5 USDC to my own wallet and the button stayed greyed out…"
              : "Tell us the unvarnished version."
          }
          className={cn(inputClass, "resize-y leading-relaxed")}
        />
      </label>

      <label className="flex flex-col gap-1">
        <span className="text-caption text-gray-light">
          Email <span className="text-gray">(optional — only if you want a reply)</span>
        </span>
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="you@example.com"
          autoComplete="email"
          spellCheck={false}
          disabled={busy}
          className={inputClass}
        />
      </label>

      <label className="flex cursor-pointer items-start gap-2.5 rounded-[10px] border border-gray/15 bg-muted/40 px-3 py-2.5">
        <input
          type="checkbox"
          checked={wantsSession}
          onChange={(event) => setWantsSession(event.target.checked)}
          disabled={busy}
          className="mt-0.5 h-4 w-4 shrink-0 accent-[var(--color-privacy)]"
        />
        <span className="text-caption text-gray-light">
          <strong className="text-foreground">I&apos;ll do a 20-minute 1-on-1.</strong> A call
          where you use the app and we shut up and watch. It is the single most useful thing a
          beta member can give us, and it needs an email above.
        </span>
      </label>

      <p className="text-caption text-gray">
        Nothing about your vault is attached — no wallet address, no balances, no notes. Only what
        you typed, the page you were on, and the network.
      </p>

      {status === "error" && error && (
        <div className="flex items-start gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <span className="text-caption text-red-400">
            {error} — you can also email{" "}
            <a className="underline underline-offset-2" href={`mailto:${FEEDBACK_EMAIL}`}>
              {FEEDBACK_EMAIL}
            </a>
            .
          </span>
        </div>
      )}

      <button
        type="button"
        onClick={submit}
        disabled={!ready}
        className={cn(
          "flex min-h-10 w-full items-center justify-center gap-2 rounded-[10px]",
          "bg-foreground px-3 py-2.5 text-caption font-semibold text-background transition-colors",
          "hover:bg-white disabled:cursor-not-allowed disabled:bg-gray/30 disabled:text-gray",
        )}
      >
        {busy && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {busy ? "Sending…" : "Send feedback"}
      </button>
    </div>
  );
}
