"use client";

/**
 * Everything submitted through /apply, for the operator.
 *
 * The sibling page, /admin/members, answers "who is in". This one answers "who
 * asked, and what did they say" — which stopped being the same question when
 * applying started issuing a code without a person reading anything.
 *
 * The reason text is the point of the page, so it is not truncated into a
 * column. Nothing here is selectable or mailable: a reply belongs in the thread
 * the application already created, where the applicant can see it.
 */

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface Application {
  id: number;
  receivedAt: number;
  email: string;
  roles: string[];
  reason: string;
  emailOptIn: boolean;
  feedbackOptIn: boolean;
  network: string | null;
  invited: boolean;
}

const when = (unix: number): string =>
  unix ? new Date(unix * 1000).toISOString().slice(0, 16).replace("T", " ") : "—";

export default function AdminApplicationsPage() {
  const [key, setKey] = useState("");
  const [rows, setRows] = useState<Application[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/applications", {
        headers: { "x-invite-admin-key": key.trim() },
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `request failed (${res.status})`);
      setRows(Array.isArray(body) ? body : (body.applications ?? []));
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load applications");
      setRows(null);
    } finally {
      setBusy(false);
    }
  }, [key]);

  // One address may apply more than once; the count that matters for cohort
  // size is people, not submissions.
  const people = useMemo(
    () => new Set((rows ?? []).map((r) => r.email.toLowerCase())).size,
    [rows],
  );
  const calls = useMemo(() => (rows ?? []).filter((r) => r.feedbackOptIn).length, [rows]);

  return (
    <main className="mx-auto flex max-w-4xl flex-col gap-5 px-4 py-10">
      <header className="flex flex-col gap-2">
        <h1 className="text-xl font-semibold text-foreground">Applications</h1>
        <p className="text-caption leading-relaxed text-gray">
          What people wrote on the way in. <strong className="text-gray-light">Invited</strong>{" "}
          means a code was issued automatically on submit — an application without it is one the
          mint could not serve, and is still waiting on a person.
        </p>
      </header>

      <div className="flex gap-2">
        <input
          type="password"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && key.trim() && load()}
          placeholder="invite admin key"
          className="flex-1 rounded-lg border border-gray/20 bg-muted/30 px-3 py-2 text-sm text-foreground focus:border-gray/40 focus:outline-none"
        />
        <button
          type="button"
          onClick={load}
          disabled={!key.trim() || busy}
          className="rounded-lg bg-foreground px-4 py-2 text-sm font-medium text-background disabled:bg-gray/30"
        >
          {busy ? "Loading…" : "Load"}
        </button>
      </div>

      {error && (
        <p className="rounded-lg border border-error/20 bg-error/5 px-3 py-2 text-sm text-error">
          {error}
        </p>
      )}

      {rows && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-caption text-gray">
            <span>{rows.length} applications</span>
            <span>· {people} distinct addresses</span>
            <span>· {rows.filter((r) => r.invited).length} auto-invited</span>
            <span>· {calls} up for a call</span>
          </div>

          {rows.length === 0 && (
            <p className="rounded-lg border border-gray/15 px-3 py-6 text-center text-caption text-gray">
              Nothing yet. Applications submitted before this page existed live only in the intake
              inbox — they were never written anywhere else.
            </p>
          )}

          <ul className="flex flex-col gap-3">
            {rows.map((row) => (
              <li
                key={row.id}
                className="flex flex-col gap-2 rounded-lg border border-gray/15 bg-muted/20 px-4 py-3"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <a
                    href={`mailto:${row.email}`}
                    className="text-sm font-medium text-foreground underline underline-offset-4"
                  >
                    {row.email}
                  </a>
                  <span className="text-caption text-gray">{when(row.receivedAt)}</span>
                </div>

                <div className="flex flex-wrap gap-1.5">
                  {row.invited && <Tag tone="good">Invited</Tag>}
                  {!row.invited && <Tag tone="warn">No code sent</Tag>}
                  {row.roles.map((role) => (
                    <Tag key={role}>{role}</Tag>
                  ))}
                  {row.feedbackOptIn && <Tag>Up for a 1-on-1</Tag>}
                  {row.emailOptIn && <Tag>Wants updates</Tag>}
                  {row.network && <Tag>{row.network}</Tag>}
                </div>

                {row.reason && (
                  <p className="whitespace-pre-wrap text-caption leading-relaxed text-gray-light">
                    {row.reason}
                  </p>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </main>
  );
}

function Tag({
  children,
  tone = "plain",
}: {
  children: React.ReactNode;
  tone?: "plain" | "good" | "warn";
}) {
  return (
    <span
      className={cn(
        "rounded-full border px-2.5 py-0.5 text-[11px]",
        tone === "good" && "border-privacy/40 bg-privacy/10 text-foreground",
        tone === "warn" && "border-error/30 bg-error/5 text-error",
        tone === "plain" && "border-gray/20 text-gray",
      )}
    >
      {children}
    </span>
  );
}
