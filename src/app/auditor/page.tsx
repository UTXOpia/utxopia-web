"use client";

/**
 * Method-Y Auditor Dashboard
 *
 * Allows a permissioned-pool auditor (who holds an Ed25519 viewing private key)
 * to scan on-chain auditor-ciphertext events, decrypt them, and view the
 * resulting AUDITOR_VISIBLE records.
 *
 * Today (2026-06-16) no permissioned pools are live, so the scan returns empty.
 * The page is code-complete against the real SDK + fetchAuditorCiphertexts API.
 *
 * SECURITY: The viewing private key is held ONLY in component state for the
 * lifetime of this component. It is never:
 *   - written to localStorage / sessionStorage / any cookie
 *   - passed to Zustand-persist
 *   - embedded in a URL param
 *   - logged via console.log / console.error / Sentry
 * The onKey callback from AuditorKeyInput receives the raw Uint8Array; it is
 * stored in a useRef (not a persisted store) and cleared when the user clears
 * the input or navigates away.
 */

import { useCallback, useRef, useState } from "react";
import { ShieldAlert, ScanSearch, Info } from "lucide-react";
import { decryptAuditorCiphertext, type AuditRecord } from "@utxopia/sdk";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { AuditorKeyInput } from "@/components/auditor/auditor-key-input";
import { AuditorRecordsTable } from "@/components/auditor/auditor-records-table";
import { TeeAttestationPanel } from "@/components/auditor/tee-attestation-panel";
import { fetchAuditorCiphertexts } from "@/lib/chain-inbox";
import { useChainEnvironment } from "@/lib/chain-environment";
import { usePoolPermissioned } from "@/hooks/use-pool-permissioned";
import { hrefWithChain } from "@/lib/network-config";
import { cn } from "@/lib/utils";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type ScanPhase = "idle" | "fetching" | "decrypting" | "done" | "error";

interface ScanStats {
  ciphertextsFound: number;
  decryptedCount: number;
}

// ---------------------------------------------------------------------------
// Main page
// ---------------------------------------------------------------------------

export default function AuditorPage() {
  const { networkId } = useChainEnvironment();
  const chainEnv = useChainEnvironment();
  const { permissioned } = usePoolPermissioned();

  // The viewing key lives in a ref so it's never serialized to any state-
  // management layer (Zustand, localStorage, URL). The ref is cleared when
  // the user clears the input field.
  const viewingPrivKeyRef = useRef<Uint8Array | null>(null);
  const [keyReady, setKeyReady] = useState(false);

  const [phase, setPhase] = useState<ScanPhase>("idle");
  const [scanError, setScanError] = useState<string | null>(null);
  const [records, setRecords] = useState<AuditRecord[] | null>(null);
  const [stats, setStats] = useState<ScanStats | null>(null);

  // -------------------------------------------------------------------------
  // Key input handler
  // -------------------------------------------------------------------------

  const handleKey = useCallback((key: Uint8Array | null) => {
    viewingPrivKeyRef.current = key;
    setKeyReady(key !== null);
    // Clear previous results when key changes
    setRecords(null);
    setStats(null);
    setScanError(null);
    setPhase("idle");
  }, []);

  // -------------------------------------------------------------------------
  // Scan handler
  // -------------------------------------------------------------------------

  const handleScan = useCallback(async () => {
    const privKey = viewingPrivKeyRef.current;
    if (!privKey) return;

    setScanError(null);
    setRecords(null);
    setStats(null);
    setPhase("fetching");

    try {
      // Step 1: fetch auditor ciphertext events from chain
      const ciphertexts = await fetchAuditorCiphertexts(chainEnv);
      setPhase("decrypting");

      // Step 2: decrypt each ciphertext with the auditor viewing private key.
      // We call decryptAuditorCiphertext directly (not auditScan) because:
      //   a) auditScan requires spendingPubKeyCompressed + nullifyingKey for the
      //      announcement-scanning path, which an auditor-only viewer doesn't have.
      //   b) We only want AUDITOR_VISIBLE records — no need for the full scan.
      const decoded: AuditRecord[] = [];
      for (const entry of ciphertexts) {
        const plain = decryptAuditorCiphertext(privKey, entry.blob, entry.commitment);
        if (!plain) continue;
        if (plain.amount <= 0n) continue;

        // Commitment as hex — convert from Uint8Array
        const commitmentHex = Array.from(entry.commitment)
          .map((b) => b.toString(16).padStart(2, "0"))
          .join("");

        decoded.push({
          slot: entry.slot ?? 0,
          blockTime: entry.blockTime ?? 0,
          leafIndex: -1, // sentinel: auditor record, not a tree leaf
          direction: "AUDITOR_VISIBLE",
          announcementType: -1,
          tokenId: plain.tokenId,
          amount: plain.amount,
          commitmentHex,
          ephemeralPubHex: "", // sentinel: auditor path uses its own ephemeral key
        });
      }

      setStats({
        ciphertextsFound: ciphertexts.length,
        decryptedCount: decoded.length,
      });
      setRecords(decoded);
      setPhase("done");
    } catch (err) {
      // Safe: err.message doesn't contain the key
      setScanError(err instanceof Error ? err.message : "An unexpected error occurred.");
      setPhase("error");
    }
  }, [chainEnv]);

  // -------------------------------------------------------------------------
  // Derived state
  // -------------------------------------------------------------------------

  const isScanning = phase === "fetching" || phase === "decrypting";
  const scanLabel =
    phase === "fetching"
      ? "Fetching events…"
      : phase === "decrypting"
        ? "Decrypting…"
        : "Scan";

  // -------------------------------------------------------------------------
  // Render
  // -------------------------------------------------------------------------

  return (
    <FlowPageLayout
      backHref={hrefWithChain("/settings", networkId)}
      backLabel="Settings"
      width={580}
      badges={[
        {
          icon: <ShieldAlert className="w-full h-full" />,
          label: "Auditor",
          color: "gray",
        },
      ]}
      titleIcon={<ShieldAlert className="w-full h-full" />}
      title="Auditor workspace"
      description="Use authorized viewing data to inspect private activity without gaining permission to spend."
      showZkBadge={false}
    >
      <div className="space-y-6">
        {/* No-permissioned-pool notice */}
        {!permissioned && (
          <NetworkNotice />
        )}

        {/* Which enclave decides policy for this pool. Only a permissioned
            pool has one; Open Privacy takes no approval path at all. */}
        {permissioned && (
          <TeeAttestationPanel networkId={networkId} vaultId="verified" />
        )}

        {/* Viewing key input */}
        <AuditorKeyInput onKey={handleKey} disabled={isScanning} />

        {/* Scan button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleScan}
            disabled={!keyReady || isScanning}
            aria-busy={isScanning}
            className={cn(
              "inline-flex items-center gap-2 px-4 py-2.5 rounded-[10px] text-sm font-medium transition-all",
              "focus:outline-none focus-visible:ring-2 focus-visible:ring-gray/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background",
              keyReady && !isScanning
                ? "bg-foreground text-background hover:bg-white cursor-pointer"
                : "bg-muted/40 text-gray cursor-not-allowed opacity-60",
            )}
          >
            <ScanSearch className="w-4 h-4" aria-hidden="true" />
            {isScanning ? scanLabel : "Scan"}
          </button>

          {stats && phase === "done" && (
            <span className="text-[11px] text-gray">
              {stats.ciphertextsFound === 0
                ? "No ciphertext events on this network."
                : `${stats.ciphertextsFound} event${stats.ciphertextsFound !== 1 ? "s" : ""} found · ${stats.decryptedCount} decrypted`}
            </span>
          )}
        </div>

        {/* Error display */}
        {scanError && (
          <div
            role="alert"
            className="flex items-start gap-2.5 px-3.5 py-3 rounded-[10px] bg-error/8 border border-error/20"
          >
            <span className="text-[12px] text-error font-mono break-all">{scanError}</span>
          </div>
        )}

        {/* Records table (loading, done, or not yet scanned) */}
        {(phase === "fetching" || phase === "decrypting") && (
          <AuditorRecordsTable records={[]} loading />
        )}

        {phase === "done" && records !== null && (
          <AuditorRecordsTable records={records} />
        )}
      </div>
    </FlowPageLayout>
  );
}

// ---------------------------------------------------------------------------
// Network notice
// ---------------------------------------------------------------------------

function NetworkNotice() {
  return (
    <div className="flex items-start gap-2.5 px-3.5 py-3 rounded-[10px] bg-gray/5 border border-gray/10">
      <Info className="w-3.5 h-3.5 text-gray shrink-0 mt-0.5" aria-hidden="true" />
      <p className="text-[11px] text-gray leading-relaxed">
        No permissioned pool is configured on this network yet. You can still
        scan — the result will be empty. When a permissioned pool goes live,
        its deposits emit auditor ciphertexts that appear here.
      </p>
    </div>
  );
}
