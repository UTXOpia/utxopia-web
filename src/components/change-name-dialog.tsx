"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AtSign, ArrowRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSnsName } from "@/hooks/use-sns-name";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getSnsConfig } from "@/lib/names/sns";

const CHANGE_PROGRESS = [
  "Preparing your new receive name...",
  "Approve the registration if prompted.",
  "Registering the new name on Solana...",
  "Releasing your old name...",
  "Still working. Keep this tab open.",
];

/**
 * Change the user's *.utxopia.sol receive name. SNS names can't be renamed in
 * place, so this registers the NEW subdomain and then releases (deletes) the
 * OLD one. The old name is orchestrated by `changeSnsName`; the new name wins
 * even if the old-name release fails.
 */
export function ChangeNameDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const sns = useSnsName();
  const { config } = useChainEnvironment();
  const snsConfig = getSnsConfig(config);
  const parentDomain = snsConfig?.parentDomain || "utxopia";
  const oldName = sns.registeredSnsName;

  const [value, setValue] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);
  const [availability, setAvailability] = useState<"idle" | "checking" | "available" | "taken">("idle");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [progressIndex, setProgressIndex] = useState(0);

  const isNameRegistered = sns.isNameRegistered;
  const clean = value.trim().toLowerCase();
  const nameValid = /^[a-z0-9-]{1,32}$/.test(clean);
  const sameAsOld = clean === (oldName ?? "").trim().toLowerCase();
  const changing = sns.isRegistering || isSubmitting;

  // Reset transient state whenever the dialog opens.
  useEffect(() => {
    if (open) {
      setValue("");
      setLocalError(null);
      setAvailability("idle");
      setProgressIndex(0);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !nameValid || sameAsOld) {
      setAvailability("idle");
      return;
    }

    let cancelled = false;
    setAvailability("checking");
    const timer = window.setTimeout(() => {
      void isNameRegistered(clean)
        .then((registered) => {
          if (!cancelled) setAvailability(registered ? "taken" : "available");
        })
        .catch(() => {
          if (!cancelled) setAvailability("idle");
        });
    }, 300);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [clean, isNameRegistered, nameValid, open, sameAsOld]);

  useEffect(() => {
    if (!changing) {
      setProgressIndex(0);
      return;
    }

    const timers = [
      window.setTimeout(() => setProgressIndex(1), 1200),
      window.setTimeout(() => setProgressIndex(2), 3500),
      window.setTimeout(() => setProgressIndex(3), 9000),
      window.setTimeout(() => setProgressIndex(4), 18000),
    ];

    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
    };
  }, [changing]);

  function dismiss(force = false) {
    if (changing && !force) return;
    onOpenChange(false);
  }

  const nameTaken = availability === "taken";
  const checkingName = availability === "checking";
  const availabilityError = sameAsOld
    ? "That's already your current name."
    : nameTaken
      ? `"${clean}.${parentDomain}.sol" is already registered`
      : null;
  const canChange = nameValid && !sameAsOld && !nameTaken && !checkingName && !changing;

  async function handleChange() {
    if (!canChange) return;
    setLocalError(null);
    setIsSubmitting(true);
    setProgressIndex(0);
    try {
      const ok = await sns.changeSnsName(clean);
      if (ok) {
        // Success — new name is live (old-name release warnings, if any, live
        // in sns.error and remain visible in settings).
        dismiss(true);
      }
    } catch (err) {
      setLocalError(err instanceof Error ? err.message : "Could not change your receive name.");
    } finally {
      setIsSubmitting(false);
    }
  }

  const oldFull = oldName ? `${oldName}.${parentDomain}.sol` : null;

  return (
    <Dialog.Root open={open} onOpenChange={(o) => { if (!o) dismiss(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 animate-in fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50",
            "w-[90vw] max-w-md p-6 rounded-[20px]",
            "bg-card border border-gray/30",
            "animate-in fade-in-0 zoom-in-95",
            "focus:outline-none",
          )}
        >
          <Dialog.Close asChild>
            <button
              onClick={() => dismiss()}
              disabled={changing}
              className="absolute right-4 top-4 p-1.5 rounded-full bg-gray/10 hover:bg-gray/20 text-gray transition-colors"
              aria-label="Close"
            >
              <X className="w-4 h-4" />
            </button>
          </Dialog.Close>

          <div className="flex justify-center mb-4">
            <div className="p-4 rounded-full bg-privacy/10 text-privacy">
              <AtSign className="w-6 h-6" />
            </div>
          </div>

          <Dialog.Title className="text-heading6 text-foreground text-center mb-2">
            Change your receive name
          </Dialog.Title>
          <Dialog.Description className="text-body2 text-gray text-center mb-6">
            {oldFull ? (
              <>
                Your current name is{" "}
                <span className="font-mono text-gray-light">{oldFull}</span>. Pick a
                new one below. This registers the new name, then releases the old
                one.
              </>
            ) : (
              <>Pick a new name so people can pay you at <span className="font-mono text-gray-light">name.{parentDomain}.sol</span>.</>
            )}
          </Dialog.Description>

          <div className="flex items-stretch rounded-[12px] border border-gray/25 bg-muted/40 overflow-hidden">
            <input
              autoFocus
              value={value}
              onChange={(e) => {
                setLocalError(null);
                setValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""));
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canChange) handleChange();
              }}
              placeholder="yournewname"
              maxLength={32}
              className="flex-1 min-w-0 bg-transparent px-3 py-3 text-sm text-foreground placeholder:text-gray/50 focus:outline-none"
            />
            <span className="flex items-center px-3 text-sm text-gray font-mono bg-muted/30 border-l border-gray/20">
              .{parentDomain}.sol
            </span>
          </div>

          {oldFull && (
            <p className="mt-3 px-1 text-[11px] leading-4 text-gray/80">
              Your current name{" "}
              <span className="font-mono text-gray-light">{oldFull}</span>{" "}
              will be released and can be claimed by others.
            </p>
          )}

          {(availabilityError || sns.error || localError) && (
            <p className="mt-2 px-1 text-[11px] text-destructive">{availabilityError || sns.error || localError}</p>
          )}
          {checkingName && (
            <p className="mt-2 px-1 text-[11px] text-gray">Checking availability...</p>
          )}
          {changing && (
            <div
              role="status"
              aria-live="polite"
              className="mt-3 flex items-start gap-2 rounded-[10px] border border-privacy/20 bg-privacy/10 px-3 py-2 text-[11px] leading-4 text-gray-light"
            >
              <Loader2 className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin text-privacy" />
              <span>{CHANGE_PROGRESS[progressIndex]}</span>
            </div>
          )}

          <div className="flex gap-3 mt-5">
            <button
              onClick={() => dismiss()}
              disabled={changing}
              className="flex-1 py-3 px-4 rounded-[12px] text-body2 text-gray hover:text-gray-light bg-gray/10 hover:bg-gray/15 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={handleChange}
              disabled={!canChange}
              className={cn(
                "flex-1 py-3 px-4 rounded-[12px] text-body2 text-background",
                "bg-foreground hover:bg-white transition-colors",
                "flex items-center justify-center gap-2",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {changing ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Changing
                </>
              ) : (
                <>
                  Change name
                  <ArrowRight className="w-4 h-4" />
                </>
              )}
            </button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
