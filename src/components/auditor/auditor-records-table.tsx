"use client";

/**
 * AuditorRecordsTable — displays AUDITOR_VISIBLE records from a Method-Y scan.
 *
 * Renders a semantic <table> with appropriate roles. Each row shows:
 *   - Amount (formatted with 8 decimal places, BTC/satoshi convention)
 *   - Token ID (truncated hex, copyable)
 *   - Commitment (truncated, copyable)
 *   - Time (relative + ISO on hover)
 *
 * Empty state teaches rather than just says "nothing here."
 */

import { useCallback } from "react";
import { FileDown, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { CopyButton } from "@/components/ui/copy-button";
import { truncateMiddle, timeAgo } from "@/lib/utils/formatting";
import { toHex64 } from "@/lib/utils/hex";
import { auditRecordsToCsv, type AuditRecord } from "@utxopia/sdk";

// ---------------------------------------------------------------------------
// Amount formatting
// ---------------------------------------------------------------------------

/**
 * Format a bigint amount using a fixed 8-decimal-place convention (satoshi/BTC)
 * with trailing-zero trimming. Falls back gracefully for unknown token decimals.
 *
 * All known UTXOpia tokens use 8 decimal places (satoshi-base), matching
 * formatAmount(n, 8) — but we work in bigint to avoid float precision loss.
 */
export function formatBigintAmount(amount: bigint, decimals = 8): string {
  if (amount === 0n) return "0";
  const divisor = BigInt(10 ** decimals);
  const whole = amount / divisor;
  const remainder = amount % divisor;
  if (remainder === 0n) return whole.toString();
  const fracStr = remainder.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr}`;
}

// ---------------------------------------------------------------------------
// Skeleton row
// ---------------------------------------------------------------------------

export function AuditRecordsSkeleton() {
  return (
    <div
      aria-hidden="true"
      aria-label="Loading audit records"
      className="space-y-2 animate-pulse"
    >
      {[...Array(3)].map((_, i) => (
        <div key={i} className="h-10 rounded-[8px] bg-gray/8" />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function EmptyState() {
  return (
    <div className="py-10 flex flex-col items-center gap-3 text-center">
      <div className="p-3 rounded-full bg-gray/8 border border-gray/10">
        <ShieldCheck className="w-5 h-5 text-gray" aria-hidden="true" />
      </div>
      <div className="space-y-1.5 max-w-[280px]">
        <p className="text-sm font-medium text-gray-light">
          No auditable records yet
        </p>
        <p className="text-[12px] text-gray leading-relaxed">
          When a permissioned pool is active, deposits to it emit auditor
          ciphertexts that appear here after a scan. Scan returned 0 records —
          either no permissioned pool is live on this network, or none of the
          ciphertexts decrypted with the provided key.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV export helper
// ---------------------------------------------------------------------------

function downloadCsv(records: AuditRecord[]) {
  const csv = auditRecordsToCsv(records);
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `utxopia-auditor-${Date.now()}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

interface AuditorRecordsTableProps {
  records: AuditRecord[];
  /** When true, show skeleton rows instead of data. */
  loading?: boolean;
}

export function AuditorRecordsTable({ records, loading }: AuditorRecordsTableProps) {
  const handleDownloadCsv = useCallback(() => {
    downloadCsv(records);
  }, [records]);

  if (loading) {
    return <AuditRecordsSkeleton />;
  }

  const auditorRecords = records.filter((r) => r.direction === "AUDITOR_VISIBLE");

  return (
    <div className="space-y-3">
      {/* Header row with count + export */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="text-[11px] uppercase tracking-[0.16em] text-gray-light font-semibold">
            Records
          </span>
          {auditorRecords.length > 0 && (
            <span className="px-1.5 py-0.5 rounded-full bg-privacy/15 text-privacy text-[10px] font-semibold tabular-nums">
              {auditorRecords.length}
            </span>
          )}
        </div>

        {auditorRecords.length > 0 && (
          <button
            type="button"
            onClick={handleDownloadCsv}
            className={cn(
              "inline-flex items-center gap-1.5 px-2.5 py-1 rounded-[6px] text-[11px] font-medium transition-colors",
              "border border-gray/15 text-gray hover:text-foreground hover:border-gray/30",
              "focus:outline-none focus-visible:ring-1 focus-visible:ring-privacy/50",
            )}
            aria-label="Download records as CSV"
          >
            <FileDown className="w-3 h-3" aria-hidden="true" />
            Export CSV
          </button>
        )}
      </div>

      {/* Table or empty state */}
      {auditorRecords.length === 0 ? (
        <EmptyState />
      ) : (
        <div className="overflow-x-auto rounded-[10px] border border-gray/10">
          <table className="min-w-full text-left" role="table">
            <thead>
              <tr className="border-b border-gray/10 bg-muted/30">
                <th
                  scope="col"
                  className="px-3 py-2.5 text-[10px] uppercase tracking-[0.14em] text-gray font-semibold whitespace-nowrap"
                >
                  Amount
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-[10px] uppercase tracking-[0.14em] text-gray font-semibold whitespace-nowrap"
                >
                  Token ID
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-[10px] uppercase tracking-[0.14em] text-gray font-semibold whitespace-nowrap"
                >
                  Commitment
                </th>
                <th
                  scope="col"
                  className="px-3 py-2.5 text-[10px] uppercase tracking-[0.14em] text-gray font-semibold whitespace-nowrap"
                >
                  Time
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray/8">
              {auditorRecords.map((r) => (
                <AuditRecordRow key={`${r.commitmentHex}-${r.slot}`} record={r} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Individual row
// ---------------------------------------------------------------------------

function AuditRecordRow({ record: r }: { record: AuditRecord }) {
  const tokenHex = toHex64(r.tokenId);
  const commitmentShort = truncateMiddle(r.commitmentHex, 8);
  const tokenShort = truncateMiddle(tokenHex, 8);
  const timeLabel = timeAgo(r.blockTime);
  const isoTime =
    r.blockTime > 0 ? new Date(r.blockTime * 1000).toISOString() : "—";

  return (
    <tr className="group transition-colors hover:bg-muted/20">
      {/* Amount */}
      <td className="px-3 py-3 whitespace-nowrap">
        <span className="text-[12px] font-mono font-semibold text-foreground tabular-nums">
          {formatBigintAmount(r.amount)}
        </span>
        <span className="ml-1 text-[10px] text-gray">sats</span>
      </td>

      {/* Token ID */}
      <td className="px-3 py-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-mono text-gray-light"
            title={tokenHex}
          >
            {tokenShort}
          </span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton
              text={tokenHex}
              label="token ID"
              iconSize="sm"
            />
          </span>
        </div>
      </td>

      {/* Commitment */}
      <td className="px-3 py-3 whitespace-nowrap">
        <div className="flex items-center gap-1.5">
          <span
            className="text-[11px] font-mono text-gray-light"
            title={r.commitmentHex}
          >
            {commitmentShort}
          </span>
          <span className="opacity-0 group-hover:opacity-100 transition-opacity">
            <CopyButton
              text={r.commitmentHex}
              label="commitment"
              iconSize="sm"
            />
          </span>
        </div>
      </td>

      {/* Time */}
      <td className="px-3 py-3 whitespace-nowrap">
        <span
          className="text-[11px] text-gray"
          title={isoTime}
          aria-label={isoTime}
        >
          {timeLabel}
        </span>
      </td>
    </tr>
  );
}
