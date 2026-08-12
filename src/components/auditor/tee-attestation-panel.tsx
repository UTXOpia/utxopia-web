"use client";

/**
 * TeeAttestationPanel — what the policy enclave *is*, not just that there is one.
 *
 * Boundary contract:
 *  - Talks only to `/api/policy/attestation`, never to the PER endpoint. The
 *    browser is never given the enclave's URL or any credential for it.
 *  - Renders only the field allowlist that route returns. A TDX measurement and
 *    its TCB status are printed on the quote itself, so they are public; the
 *    endpoint that produced them is not.
 *
 * `pinned: false` means the quote proved a genuine TDX enclave answered but
 * nothing checked *which* enclave. That is a bootstrap state, not a demo state,
 * so it renders as a warning rather than a pass.
 */

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck, ShieldAlert, ShieldQuestion, RefreshCw, ChevronDown } from "lucide-react";
import { CopyButton } from "@/components/ui";
import { cn } from "@/lib/utils";

export interface TeeAttestation {
  measurement: string;
  mrTd: string;
  rtmr: string[];
  tcbStatus: string;
  advisoryIds: string[];
  pinned: boolean;
  verifiedAt: number;
}

type Verdict = "pinned" | "unpinned" | "failed" | "absent";

/**
 * A 404 means this deployment's backend predates the attestation endpoint, not
 * that an enclave failed to prove itself. Those are opposite claims and must
 * not share a colour: the frontend ships separately from the backend, so
 * "absent" is the normal state during a rollout and renders as nothing at all.
 * Red is reserved for an enclave that answered and did not check out.
 */
export function attestationVerdict(
  attestation: TeeAttestation | null,
  error: string | null,
  status?: number,
): Verdict {
  if (status === 404) return "absent";
  if (error || !attestation) return "failed";
  return attestation.pinned ? "pinned" : "unpinned";
}

/** Seconds since the quote was verified, for the "as of" line. */
export function attestationAge(verifiedAt: number, nowMs: number): string {
  const seconds = Math.max(0, Math.floor(nowMs / 1000) - verifiedAt);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  return `${Math.floor(seconds / 3600)}h ago`;
}

export function shortMeasurement(measurement: string): string {
  return measurement.length > 20
    ? `${measurement.slice(0, 10)}…${measurement.slice(-10)}`
    : measurement;
}

const VERDICT_STYLE: Record<
  Exclude<Verdict, "absent">,
  { icon: typeof ShieldCheck; tone: string; label: string }
> = {
  pinned: {
    icon: ShieldCheck,
    tone: "text-emerald-400 border-emerald-500/30 bg-emerald-500/5",
    label: "Enclave verified",
  },
  unpinned: {
    icon: ShieldQuestion,
    tone: "text-amber-400 border-amber-500/30 bg-amber-500/5",
    label: "Genuine TDX, not pinned",
  },
  failed: {
    icon: ShieldAlert,
    tone: "text-red-400 border-red-500/30 bg-red-500/5",
    label: "Attestation failed",
  },
};

interface TeeAttestationPanelProps {
  networkId: string;
  vaultId: string;
  className?: string;
  /** Poll interval; 0 disables. The backend answers from cache, so this is cheap. */
  pollMs?: number;
}

/** Shared by the panel and the badge so there is one fetch, one absent-state
 *  rule, and one place the `force` cost is paid. */
function useAttestation(networkId: string, vaultId: string, pollMs: number) {
  const [attestation, setAttestation] = useState<TeeAttestation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<number | undefined>(undefined);
  const [attesting, setAttesting] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const load = useCallback(
    async (force: boolean) => {
      const params = new URLSearchParams({ network: networkId, vault: vaultId });
      if (force) params.set("force", "true");
      try {
        const response = await fetch(`/api/policy/attestation?${params}`, {
          cache: "no-store",
        });
        const body = await response.json().catch(() => ({}));
        setStatus(response.status);
        if (!response.ok) {
          setError(body.details || body.error || `Attestation returned ${response.status}`);
          return;
        }
        setAttestation(body as TeeAttestation);
        setError(null);
      } catch {
        setStatus(undefined);
        setError("Attestation unreachable");
      }
    },
    [networkId, vaultId],
  );

  useEffect(() => {
    void load(false);
    if (!pollMs) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      void load(false);
    }, pollMs);
    return () => clearInterval(timer);
  }, [load, pollMs]);

  const attestNow = async () => {
    setAttesting(true);
    await load(true);
    setNow(Date.now());
    setAttesting(false);
  };

  return {
    attestation,
    error,
    attesting,
    now,
    attestNow,
    verdict: attestationVerdict(attestation, error, status),
  };
}

export function TeeAttestationPanel({
  networkId,
  vaultId,
  className,
  pollMs = 15_000,
}: TeeAttestationPanelProps) {
  const { attestation, error, attesting, now, attestNow, verdict } = useAttestation(
    networkId,
    vaultId,
    pollMs,
  );
  if (verdict === "absent") return null;
  const { icon: Icon, tone, label } = VERDICT_STYLE[verdict];

  return (
    <div className={cn("rounded-xl border p-4", tone, className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          <Icon className="h-5 w-5 shrink-0" aria-hidden />
          <div>
            <p className="font-medium leading-tight">{label}</p>
            <p className="text-xs text-white/50">
              Intel TDX · policy decided inside the enclave
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={attestNow}
          disabled={attesting}
          className="flex items-center gap-1.5 rounded-lg border border-white/10 px-2.5 py-1.5 text-xs text-white/70 transition hover:bg-white/5 disabled:opacity-50"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", attesting && "animate-spin")} aria-hidden />
          Attest now
        </button>
      </div>

      {error && <p className="mt-3 text-sm text-red-300">{error}</p>}

      {attestation && !error && (
        <dl className="mt-4 space-y-2 text-xs">
          <Row label="Measurement">
            <span className="font-mono">{shortMeasurement(attestation.measurement)}</span>
            <CopyButton text={attestation.measurement} label="measurement" iconSize="sm" />
          </Row>
          <Row label="TCB">
            <span>{attestation.tcbStatus}</span>
            {attestation.advisoryIds.length > 0 && (
              <span className="text-white/40">
                {attestation.advisoryIds.length} advisory
                {attestation.advisoryIds.length === 1 ? "" : "s"}
              </span>
            )}
          </Row>
          <Row label="Verified">
            <span>{attestationAge(attestation.verifiedAt, now)}</span>
          </Row>
          {!attestation.pinned && (
            <p className="pt-1 text-amber-300/80">
              No expected measurement is configured, so this quote is not matched
              to a known enclave.
            </p>
          )}
        </dl>
      )}
    </div>
  );
}

interface TeeAttestationBadgeProps {
  networkId: string;
  vaultId: string;
  className?: string;
}

/**
 * The user-facing form: one line beside "Checking privacy policy…", answering
 * the question that message otherwise leaves open — checked privately by what?
 *
 * Deliberately passive. A user cannot evaluate a measurement hex string, and
 * making them click "I verified this" would manufacture a check they did not
 * perform. The value is that it is here and independently verifiable, not that
 * every user verifies it. Detail is one disclosure away for those who care.
 */
export function TeeAttestationBadge({
  networkId,
  vaultId,
  className,
}: TeeAttestationBadgeProps) {
  const { attestation, verdict } = useAttestation(networkId, vaultId, 30_000);
  const [open, setOpen] = useState(false);

  if (verdict === "absent" || verdict === "failed" || !attestation) return null;

  return (
    <div
      className={cn(
        "rounded-[10px] border px-3 py-2 text-[11px]",
        verdict === "pinned"
          ? "border-emerald-500/25 bg-emerald-500/5"
          : "border-amber-500/25 bg-amber-500/5",
        className,
      )}
    >
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="flex w-full items-center gap-2 text-left"
        aria-expanded={open}
      >
        <ShieldCheck
          className={cn(
            "h-3.5 w-3.5 shrink-0",
            verdict === "pinned" ? "text-emerald-400" : "text-amber-400",
          )}
          aria-hidden
        />
        <span className="text-gray-light">Intel TDX</span>
        <span className="font-mono text-gray">
          {shortMeasurement(attestation.measurement)}
        </span>
        <ChevronDown
          className={cn(
            "ml-auto h-3 w-3 shrink-0 text-gray transition-transform",
            open && "rotate-180",
          )}
          aria-hidden
        />
      </button>

      {open && (
        <dl className="mt-2 space-y-1 border-t border-gray/10 pt-2">
          <Row label="MRTD">
            <span className="font-mono">{shortMeasurement(attestation.mrTd)}</span>
          </Row>
          {attestation.rtmr.map((value, index) => (
            <Row key={index} label={`RTMR${index}`}>
              <span className="font-mono">{shortMeasurement(value)}</span>
            </Row>
          ))}
          <Row label="TCB">
            <span>{attestation.tcbStatus}</span>
          </Row>
          {!attestation.pinned && (
            <p className="pt-1 text-amber-300/80">
              Genuine TDX, but not matched to a known enclave.
            </p>
          )}
        </dl>
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-white/40">{label}</dt>
      <dd className="flex items-center gap-2 text-white/80">{children}</dd>
    </div>
  );
}
