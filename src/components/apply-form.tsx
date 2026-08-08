"use client";

import { useState } from "react";
import { AlertCircle, Check, Loader2 } from "lucide-react";
import { useChainEnvironment } from "@/lib/chain-environment";
import { cn } from "@/lib/utils";

type Status = "idle" | "sending" | "done" | "error";

const inputClass = cn(
  "min-h-10 w-full rounded-[10px] border border-gray/20 bg-transparent px-3 py-2",
  "text-caption text-foreground placeholder:text-gray",
  "focus:border-gray/40 focus:outline-none disabled:opacity-60",
);

/**
 * The five questions from `launch/OUTREACH.md`, plus an email and where they
 * heard about it.
 *
 * Nothing here issues a code. The form's own copy says applications are read
 * by a person and most get a no, because that is true and because a form that
 * implies automatic admission attracts exactly the applicants this cohort is
 * meant to filter out.
 */
export function ApplyForm({ className }: { className?: string }) {
  const { networkId } = useChainEnvironment();

  const [email, setEmail] = useState("");
  const [who, setWho] = useState("");
  const [useCase, setUseCase] = useState("");
  const [cliOk, setCliOk] = useState<boolean | null>(null);
  const [background, setBackground] = useState("");
  const [distrust, setDistrust] = useState("");
  const [source, setSource] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [error, setError] = useState<string | null>(null);

  const busy = status === "sending";
  const ready =
    !busy &&
    email.trim().length > 3 &&
    who.trim().length > 1 &&
    useCase.trim().length > 1 &&
    distrust.trim().length > 1 &&
    cliOk !== null;

  const submit = async () => {
    setError(null);
    setStatus("sending");
    try {
      const response = await fetch("/api/apply", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: email.trim(),
          who: who.trim(),
          useCase: useCase.trim(),
          cliOk,
          background: background.trim(),
          distrust: distrust.trim(),
          source: source.trim(),
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

      <Field label="Who are you, and where can we see your work?" hint="links are enough">
        <input
          value={who}
          onChange={(event) => setWho(event.target.value)}
          placeholder="github.com/… , @handle, a paper, a repo"
          disabled={busy}
          className={inputClass}
        />
      </Field>

      <Field
        label="What would you actually move through something like this?"
        hint="or would want to — a real answer beats an enthusiastic one"
      >
        <textarea
          value={useCase}
          onChange={(event) => setUseCase(event.target.value)}
          rows={3}
          maxLength={2000}
          disabled={busy}
          className={cn(inputClass, "resize-y leading-relaxed")}
        />
      </Field>

      {/* Not a Field: a <label> wrapping buttons has no control to point at. */}
      <div className="flex flex-col gap-1.5">
        <span className="text-caption text-gray-light">
          Can you run a CLI script and paste your full failing state?{" "}
          <span className="text-gray">
            — this phase asks for both. &ldquo;No&rdquo; is a fine answer and does not rule you out
            of later phases.
          </span>
        </span>
        <div className="flex gap-1.5">
          {[
            { value: true, label: "Yes" },
            { value: false, label: "No" },
          ].map((option) => (
            <button
              key={option.label}
              type="button"
              onClick={() => setCliOk(option.value)}
              disabled={busy}
              className={cn(
                "rounded-full border px-4 py-1 text-caption transition-colors",
                cliOk === option.value
                  ? "border-privacy/40 bg-privacy/10 text-foreground"
                  : "border-gray/20 text-gray hover:border-gray/40 hover:text-gray-light",
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <Field
        label="Have you self-custodied bitcoin? Used a shielded protocol?"
        hint="optional — Zcash, Tornado, Railgun, Penumbra, Sparrow, Nunchuk, anything"
      >
        <textarea
          value={background}
          onChange={(event) => setBackground(event.target.value)}
          rows={2}
          maxLength={2000}
          disabled={busy}
          className={cn(inputClass, "resize-y leading-relaxed")}
        />
      </Field>

      <Field
        label="What would have to happen for you to stop trusting us with this?"
        hint="the one we most want answered. Be unkind."
      >
        <textarea
          value={distrust}
          onChange={(event) => setDistrust(event.target.value)}
          rows={3}
          maxLength={2000}
          disabled={busy}
          className={cn(inputClass, "resize-y leading-relaxed")}
        />
      </Field>

      <Field label="Where did you hear about this?" hint="optional">
        <input
          value={source}
          onChange={(event) => setSource(event.target.value)}
          placeholder="a DM from us, a post, a friend…"
          disabled={busy}
          className={inputClass}
        />
      </Field>

      <p className="text-caption leading-relaxed text-gray">
        Nothing about a wallet is attached to this — no address, no balances. It is an email and
        your answers, and it reaches the people building the thing.
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
