"use client";

import { useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useChainEnvironment } from "@/lib/chain-environment";
import { APPLY_ROLES, type ApplyRole } from "@/lib/apply-roles";
import { cn } from "@/lib/utils";

type Status = "idle" | "sending" | "done" | "error";

const inputClass = cn(
  "min-h-10 w-full rounded-[10px] border border-gray/20 bg-transparent px-3 py-2",
  "text-caption text-foreground placeholder:text-gray",
  "focus:border-gray/40 focus:outline-none disabled:opacity-60",
);

/**
 * An email, a self-description, one open question, and two opt-ins.
 *
 * This used to ask the five screening questions from `launch/OUTREACH.md`. They
 * were good questions — but a seven-field form in front of a stranger screens
 * for patience more than for fit, and the screening it did buy is better done
 * in the conversation the second opt-in asks for. So the form's job is now to
 * start that conversation, not to decide it.
 *
 * The opt-ins default to off and are asked separately, because "wants a look at
 * the beta" and "will give us an hour on a call" are different consents, and
 * bundling them means neither answer is worth anything.
 *
 * The role chips are optional and multi-select: most of the people worth
 * admitting are two or three of them at once, and a required field that only
 * sorts an inbox is friction charged to the applicant.
 *
 * Still true, and still said plainly below: nothing here issues a code.
 */
export function ApplyForm({ className }: { className?: string }) {
  const { networkId } = useChainEnvironment();

  const [email, setEmail] = useState("");
  const [roles, setRoles] = useState<ApplyRole[]>([]);
  const [reason, setReason] = useState("");
  const [emailOptIn, setEmailOptIn] = useState(false);
  const [feedbackOptIn, setFeedbackOptIn] = useState(false);
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = status === "sending";
  const ready = !busy && email.trim().length > 3 && reason.trim().length > 1;

  const submit = async () => {
    setError(null);
    setStatus("sending");
    try {
      const response = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          roles,
          reason: reason.trim(),
          emailOptIn,
          feedbackOptIn,
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
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "could not send that");
      setStatus("error");
    }
  };

  if (status === "done") {
    return (
      <div
        className="flex items-start gap-2 rounded-[12px] border border-privacy/25 bg-privacy/10 px-4 py-3.5"
        role="status"
      >
        <Check className="mt-0.5 h-4 w-4 shrink-0 text-privacy" aria-hidden />
        <span className="text-caption leading-relaxed text-gray-light">
          <strong className="text-foreground">Got it.</strong> A person reads every one of these,
          usually within a couple of days. If we send a code it comes from a human reply to this
          address — never from a link in a post, and never automatically.
        </span>
      </div>
    );
  }

  return (
    <div className={cn("flex flex-col gap-4", className)}>
      <Field label="Email" hint="where a code would go, if we send one">
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
      </Field>

      {/* Not a Field: a <label> wrapping buttons has no single control to point
          at, so it would announce the wrong thing to a screen reader. */}
      <fieldset className="flex flex-col gap-1.5">
        <legend className="text-caption text-gray-light">
          What best describes you? <span className="text-gray">— optional, pick any that fit</span>
        </legend>
        <div className="flex flex-wrap gap-1.5">
          {APPLY_ROLES.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={roles.includes(option)}
              onClick={() =>
                setRoles((current) =>
                  current.includes(option)
                    ? current.filter((entry) => entry !== option)
                    : [...current, option],
                )
              }
              disabled={busy}
              className={cn(
                "rounded-full border px-3.5 py-1 text-caption transition-colors disabled:opacity-60",
                roles.includes(option)
                  ? "border-privacy/40 bg-privacy/10 text-foreground"
                  : "border-gray/20 text-gray hover:border-gray/40 hover:text-gray-light",
              )}
            >
              {option}
            </button>
          ))}
        </div>
      </fieldset>

      <Field label="Why are you interested?" hint="a couple of sentences is plenty">
        <textarea
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          rows={4}
          maxLength={2000}
          disabled={busy}
          className={cn(inputClass, "resize-y leading-relaxed")}
        />
      </Field>

      <div className="flex flex-col gap-2.5">
        <Consent
          checked={emailOptIn}
          onChange={setEmailOptIn}
          disabled={busy}
          label="Email me when there is something worth reading"
          hint="occasional, and you can stop it with one reply"
        />
        <Consent
          checked={feedbackOptIn}
          onChange={setFeedbackOptIn}
          disabled={busy}
          label="I'm up for a 1-on-1 feedback call"
          hint="30 minutes, whenever suits you"
        />
      </div>

      <p className="text-caption leading-relaxed text-gray">
        No wallet is attached to this — no address, no balances. Just an email and your answer.
      </p>

      {status === "error" && error && (
        <div className="flex items-start gap-2 rounded-[10px] border border-red-500/20 bg-red-500/10 p-3">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />
          <span className="text-caption text-red-400">{error}</span>
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
        {busy ? "Sending…" : "Apply"}
      </button>
    </div>
  );
}

function Field({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-caption text-gray-light">
        {label} {hint && <span className="text-gray">— {hint}</span>}
      </span>
      {children}
    </label>
  );
}

/** An opt-in. Unchecked by default: a consent that ships pre-agreed is not one. */
function Consent({
  checked,
  onChange,
  disabled,
  label,
  hint,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  disabled: boolean;
  label: string;
  hint: string;
}) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        disabled={disabled}
        className={cn(
          "mt-0.5 h-4 w-4 shrink-0 cursor-pointer appearance-none rounded-[5px]",
          "border border-gray/30 transition-colors disabled:opacity-60",
          checked && "border-privacy/50 bg-privacy/70",
        )}
      />
      <span className="text-caption leading-relaxed text-gray-light">
        {label} <span className="text-gray">— {hint}</span>
      </span>
    </label>
  );
}
