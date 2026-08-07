"use client";

/**
 * The Verified cohort, for the operator.
 *
 * Mailing is a `mailto:` with the selected addresses in BCC rather than a send
 * button: there is no mail provider configured, and a button that silently
 * fails is worse than one that opens the client you already use. BCC because
 * these members did not agree to be shown to each other.
 */

import { useCallback, useMemo, useState } from "react";
import { cn } from "@/lib/utils";

interface Member {
  wallet: string;
  email: string | null;
  redeemedAt: number | null;
  approvedInteractions: number;
  distinctActions: number;
  lastSeenAt: number | null;
}

const when = (unix: number | null): string =>
  unix ? new Date(unix * 1000).toISOString().slice(0, 10) : "—";

const daysSince = (unix: number | null): string =>
  unix ? `${Math.floor((Date.now() / 1000 - unix) / 86400)}d` : "—";

export default function AdminMembersPage() {
  const [key, setKey] = useState("");
  const [members, setMembers] = useState<Member[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/members", {
        headers: { "x-invite-admin-key": key.trim() },
        cache: "no-store",
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body?.error ?? `request failed (${res.status})`);
      setMembers(body.members ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "could not load members");
      setMembers(null);
    } finally {
      setBusy(false);
    }
  }, [key]);

  const withEmail = useMemo(
    () => (members ?? []).filter((m) => m.email),
    [members],
  );
  const selectedEmails = useMemo(
    () => withEmail.filter((m) => selected.has(m.wallet)).map((m) => m.email!),
    [withEmail, selected],
  );

  const toggle = (wallet: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(wallet)) next.delete(wallet);
      else next.add(wallet);
      return next;
    });

  return (
    <main className="mx-auto max-w-5xl px-4 py-10 space-y-6">
      <header className="space-y-1">
        <h1 className="text-lg font-semibold text-foreground">Verified cohort</h1>
        <p className="text-caption text-gray">
          Approved interactions only. A member who cashes out to their registered
          address asks the coordinator nothing, so that activity cannot appear
          here — zero means &ldquo;never needed us&rdquo;, not necessarily
          &ldquo;never came back&rdquo;.
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

      {members && (
        <>
          <div className="flex flex-wrap items-center gap-3 text-caption text-gray">
            <span>{members.length} members</span>
            <span>· {withEmail.length} with an address</span>
            <span>· {members.filter((m) => m.approvedInteractions === 0).length} with no approved activity</span>
          </div>

          <div className="overflow-x-auto rounded-lg border border-gray/15">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/40 text-caption text-gray">
                <tr>
                  <th className="px-3 py-2 w-8"></th>
                  <th className="px-3 py-2">Email</th>
                  <th className="px-3 py-2">Wallet</th>
                  <th className="px-3 py-2">Joined</th>
                  <th className="px-3 py-2 text-right">Interactions</th>
                  <th className="px-3 py-2 text-right">Kinds</th>
                  <th className="px-3 py-2 text-right">Last seen</th>
                </tr>
              </thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.wallet} className="border-t border-gray/10">
                    <td className="px-3 py-2">
                      <input
                        type="checkbox"
                        disabled={!m.email}
                        checked={selected.has(m.wallet)}
                        onChange={() => toggle(m.wallet)}
                      />
                    </td>
                    <td className="px-3 py-2 text-foreground/90">
                      {m.email ?? <span className="text-gray/50">— no address</span>}
                    </td>
                    <td className="px-3 py-2 font-mono text-xs text-gray">
                      {m.wallet.slice(0, 8)}…{m.wallet.slice(-4)}
                    </td>
                    <td className="px-3 py-2 text-gray">{when(m.redeemedAt)}</td>
                    <td
                      className={cn(
                        "px-3 py-2 text-right font-mono",
                        m.approvedInteractions === 0 ? "text-warning" : "text-foreground",
                      )}
                    >
                      {m.approvedInteractions}
                    </td>
                    <td className="px-3 py-2 text-right font-mono text-gray">{m.distinctActions}</td>
                    <td className="px-3 py-2 text-right text-gray">{daysSince(m.lastSeenAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set(withEmail.map((m) => m.wallet)))}
              className="rounded-lg border border-gray/20 px-3 py-2 text-sm text-foreground"
            >
              Select all with an address
            </button>
            <button
              type="button"
              disabled={selectedEmails.length === 0}
              onClick={() => navigator.clipboard.writeText(selectedEmails.join(", "))}
              className="rounded-lg border border-gray/20 px-3 py-2 text-sm text-foreground disabled:text-gray/40"
            >
              Copy {selectedEmails.length || ""} address{selectedEmails.length === 1 ? "" : "es"}
            </button>
            <a
              href={`mailto:?bcc=${encodeURIComponent(selectedEmails.join(","))}`}
              className={cn(
                "rounded-lg bg-foreground px-3 py-2 text-sm font-medium text-background",
                selectedEmails.length === 0 && "pointer-events-none bg-gray/30",
              )}
            >
              Email selected (BCC)
            </a>
          </div>
        </>
      )}
    </main>
  );
}
