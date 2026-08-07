"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Check,
  CheckCircle2,
  ChevronDown,
  Circle,
  Copy,
  Download,
  PlusCircle,
  ShieldCheck,
} from "lucide-react";
import type { UTXOpiaKeys } from "@utxopia/sdk";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import {
  createVaultBackupPayload,
  downloadVaultBackup,
  getBackupIdentityForKeys,
  markVaultBackupComplete,
} from "@/lib/vault-backup";
import { notifyCopied } from "@/lib/notifications";
import { cn } from "@/lib/utils";

// Once a vault has held funds, "Add funds" stays done even if the balance
// is later spent to zero, so the checklist only nudges first-run users.
const FUNDED_STATUS_PREFIX = "utxo:funded:";

interface VaultFirstStepsProps {
  keys: UTXOpiaKeys | null;
  hasBackup: boolean;
  hasFunds: boolean;
  depositHref?: string;
  onBackupComplete?: () => void;
}

export function VaultFirstSteps({
  keys,
  hasBackup,
  hasFunds,
  depositHref = "/vault/deposit",
  onBackupComplete,
}: VaultFirstStepsProps) {
  const identity = useMemo(() => getBackupIdentityForKeys(keys), [keys]);
  // Collapsed by default; the header row still shows progress and the
  // pending-backup dot, and sending stays gated until backup is done.
  const [isExpanded, setIsExpanded] = useState(false);
  const [downloaded, setDownloaded] = useState(false);
  const [everFunded, setEverFunded] = useState(false);
  const { copied, copy } = useCopyToClipboard();

  useEffect(() => {
    if (!identity) return;
    if (hasFunds) {
      localStorage.setItem(FUNDED_STATUS_PREFIX + identity, "1");
      setEverFunded(true);
    } else {
      setEverFunded(localStorage.getItem(FUNDED_STATUS_PREFIX + identity) === "1");
    }
  }, [hasFunds, identity]);

  const fundsDone = hasFunds || everFunded;

  if (fundsDone && hasBackup) return null;

  const doneCount = (fundsDone ? 1 : 0) + (hasBackup ? 1 : 0);
  const totalSteps = 2;
  const tone = {
    border: "border-privacy/15",
    bg: "bg-privacy/5",
    hoverBg: "hover:bg-privacy/5",
    dot: "bg-privacy",
    doneBg: "bg-privacy/5",
    icon: "text-privacy",
    button: "bg-foreground text-background hover:bg-white",
  };

  // Taking a copy of the keys — downloaded or copied — is what completes the
  // step; there is no upload-back check to gate sending on.
  const handleDownloadBackup = () => {
    if (!identity) return;
    downloadVaultBackup(identity);
    setDownloaded(true);
    markVaultBackupComplete(identity);
    onBackupComplete?.();
  };

  const handleCopyBackup = () => {
    if (!identity) return;
    const payload = createVaultBackupPayload(identity);
    copy(JSON.stringify(payload, null, 2));
    notifyCopied("Private vault recovery backup");
    markVaultBackupComplete(identity);
    onBackupComplete?.();
  };

  // Funds without a backup are unrecoverable if keys are lost — escalate
  // the collapsed row to a warning instead of a neutral brand chip.
  const fundsAtRisk = fundsDone && !hasBackup;

  return (
    <div className={cn("mb-4 rounded-[12px] border", fundsAtRisk ? "border-warning/25 bg-warning/5" : [tone.border, tone.bg])}>
      <button
        onClick={() => setIsExpanded((open) => !open)}
        aria-expanded={isExpanded}
        className={cn("flex w-full cursor-pointer items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-left transition-colors", fundsAtRisk ? "hover:bg-warning/5" : tone.hoverBg)}
      >
        <span className={cn("h-1.5 w-1.5 shrink-0 rounded-full", fundsAtRisk ? "bg-warning" : tone.dot)} />
        <span className="text-caption font-semibold text-foreground">
          Set up your wallet
        </span>
        {fundsAtRisk ? (
          <span className="text-caption font-semibold text-warning">Back up required</span>
        ) : (
          <span className="text-caption text-gray">{doneCount} of {totalSteps} done</span>
        )}
        <ChevronDown
          className={cn(
            "ml-auto h-3.5 w-3.5 shrink-0 text-gray transition-transform",
            isExpanded && "rotate-180",
          )}
        />
      </button>

      {isExpanded && (
        <div className="space-y-2 px-3 pb-3">
          {/* Step 1: Add funds */}
          <div
            className={cn(
              "flex items-start gap-2.5 rounded-[9px] px-2.5 py-2",
              fundsDone ? tone.doneBg : "bg-muted/30",
            )}
          >
            <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
              {fundsDone ? (
                <CheckCircle2 className={cn("h-4 w-4", tone.icon)} />
              ) : (
                <Circle className="h-4 w-4 text-gray/45" />
              )}
            </div>
            <PlusCircle className={cn("mt-0.5 h-4 w-4 shrink-0", fundsDone ? tone.icon : "text-gray/60")} />
            <div className="min-w-0 flex-1">
              <p className={cn("text-caption font-semibold", fundsDone ? tone.icon : "text-foreground")}>
                Add funds
              </p>
              <p className="text-[11px] text-gray/60">
                Deposit to your own private address by default.
              </p>
            </div>
            {!fundsDone && (
              <Link
                href={depositHref}
                className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-caption font-semibold transition-colors", tone.button)}
              >
                Add funds
              </Link>
            )}
          </div>

          {/* Step 2: Back up private wallet */}
          <div
            className={cn(
              "rounded-[9px] px-2.5 py-2",
              hasBackup ? tone.doneBg : "bg-muted/30",
            )}
          >
            <div className="flex items-start gap-2.5">
              <div className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center">
                {hasBackup ? (
                  <CheckCircle2 className={cn("h-4 w-4", tone.icon)} />
                ) : (
                  <Circle className="h-4 w-4 text-gray/45" />
                )}
              </div>
              <ShieldCheck className={cn("mt-0.5 h-4 w-4 shrink-0", hasBackup ? tone.icon : "text-gray/60")} />
              <div className="min-w-0">
                <p className={cn("text-caption font-semibold", hasBackup ? tone.icon : "text-foreground")}>
                  Back up private vault
                </p>
                <p className="text-[11px] text-gray/60">
                  Your passkey unlocks this device. Only this recovery file can restore private funds if access is lost.
                </p>
              </div>
            </div>
            {!hasBackup && identity && keys && (
              <div className="mt-2 flex flex-wrap items-center gap-2 pl-[30px]">
                <button
                  onClick={handleDownloadBackup}
                  className={cn("inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] px-3 py-1.5 text-caption font-semibold transition-colors", tone.button)}
                >
                  {downloaded ? <Check className="h-3.5 w-3.5" /> : <Download className="h-3.5 w-3.5" />}
                  {downloaded ? "Backup downloaded" : "Download backup (.json)"}
                </button>
                <button
                  onClick={handleCopyBackup}
                  className="inline-flex cursor-pointer items-center gap-1.5 rounded-[8px] bg-muted px-3 py-1.5 text-caption font-semibold text-gray-light transition-colors hover:bg-muted/80"
                >
                  {copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
