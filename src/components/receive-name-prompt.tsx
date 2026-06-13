"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { AtSign, ArrowRight, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSnsName } from "@/hooks/use-sns-name";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getConfig } from "@utxopia/sdk";
import { claimPrivateReceiveName } from "@/lib/names/private-name-claim";

const SEEN_KEY = "utxopia-name-prompt-seen";

/**
 * First-login nudge to claim a private receive name. Shows once, after the user
 * is logged in and able to register, only if they don't already have a name.
 * Skippable — a name is a convenience, not a requirement.
 */
export function ReceiveNamePrompt() {
  const sns = useSnsName();
  const { networkId } = useChainEnvironment();
  const parentDomain = getConfig().snsParentDomain || "utxopia";

  // Default to "seen" so nothing flashes during SSR / before we read storage.
  const [seen, setSeen] = useState(true);
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState("");

  useEffect(() => {
    if (typeof window === "undefined") return;
    setSeen(localStorage.getItem(SEEN_KEY) === "true");
  }, []);

  useEffect(() => {
    if (!seen && sns.canRegister && !sns.hasRegisteredSnsName && !sns.isLoading) {
      setOpen(true);
    }
  }, [seen, sns.canRegister, sns.hasRegisteredSnsName, sns.isLoading]);

  // If a name shows up (registered here or elsewhere), close.
  useEffect(() => {
    if (sns.hasRegisteredSnsName) setOpen(false);
  }, [sns.hasRegisteredSnsName]);

  function dismiss() {
    if (typeof window !== "undefined") localStorage.setItem(SEEN_KEY, "true");
    setSeen(true);
    setOpen(false);
  }

  async function handleRegister() {
    const name = value.trim().toLowerCase();
    if (!name) return;
    try {
      await claimPrivateReceiveName({
        chain: "solana",
        name,
        networkId,
        solanaClaim: sns.registerSnsSubdomain,
      });
      dismiss();
    } catch {
      // useSnsName owns the user-facing error (sns.error).
    }
  }

  if (!open) return null;

  const clean = value.trim().toLowerCase();
  const nameValid = /^[a-z0-9-]{1,32}$/.test(clean);

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
              onClick={dismiss}
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
            Claim your receive name
          </Dialog.Title>
          <Dialog.Description className="text-body2 text-gray text-center mb-6">
            Pick a name so people can pay you at{" "}
            <span className="font-mono text-gray-light">name.{parentDomain}.sol</span>{" "}
            instead of a long address. It resolves to a private, unlinkable receive
            address — your balances stay hidden.
          </Dialog.Description>

          <div className="flex items-stretch rounded-[12px] border border-gray/25 bg-muted/40 overflow-hidden">
            <input
              autoFocus
              value={value}
              onChange={(e) => setValue(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ""))}
              onKeyDown={(e) => {
                if (e.key === "Enter" && nameValid && !sns.isRegistering) handleRegister();
              }}
              placeholder="yourname"
              maxLength={32}
              className="flex-1 min-w-0 bg-transparent px-3 py-3 text-sm text-foreground placeholder:text-gray/50 focus:outline-none"
            />
            <span className="flex items-center px-3 text-sm text-gray font-mono bg-muted/30 border-l border-gray/20">
              .{parentDomain}.sol
            </span>
          </div>
          {sns.error && (
            <p className="mt-2 px-1 text-[11px] text-destructive">{sns.error}</p>
          )}

          <div className="flex gap-3 mt-5">
            <button
              onClick={dismiss}
              className="flex-1 py-3 px-4 rounded-[12px] text-body2 text-gray hover:text-gray-light bg-gray/10 hover:bg-gray/15 transition-colors"
            >
              Maybe later
            </button>
            <button
              onClick={handleRegister}
              disabled={!nameValid || sns.isRegistering}
              className={cn(
                "flex-1 py-3 px-4 rounded-[12px] text-body2 text-background",
                "bg-foreground hover:bg-white transition-colors",
                "flex items-center justify-center gap-2",
                "disabled:opacity-50 disabled:cursor-not-allowed",
              )}
            >
              {sns.isRegistering ? (
                <Loader2 className="w-4 h-4 animate-spin" />
              ) : (
                <>
                  Register
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
