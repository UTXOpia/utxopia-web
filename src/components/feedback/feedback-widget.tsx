"use client";

import { useEffect, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import { MessageSquarePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { FeedbackForm } from "./feedback-form";

const OPEN_EVENT = "utxopia:open-feedback";

/**
 * Open the feedback dialog from anywhere.
 *
 * The widget is mounted once in `providers.tsx`, so an event is all a caller
 * needs — no context, no provider, no prop drilled through pages that do not
 * care. Sending someone to a separate page for this loses their place, which
 * for "this just broke" is the whole context worth capturing.
 */
export function openFeedback(): void {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OPEN_EVENT));
}

/**
 * Always-present feedback button.
 *
 * It lives on every page on purpose: the reports worth having are the ones
 * written in the ten seconds after something goes wrong, and a member who has
 * to go find a form has already decided to shrug instead. Mounted globally in
 * `providers.tsx`.
 */
export function FeedbackWidget() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const show = () => setOpen(true);
    window.addEventListener(OPEN_EVENT, show);
    return () => window.removeEventListener(OPEN_EVENT, show);
  }, []);

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild>
        <button
          type="button"
          aria-label="Send beta feedback"
          className={cn(
            "fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full",
            "border border-gray/25 bg-card/90 px-3.5 py-2.5 backdrop-blur-lg",
            "text-caption font-medium text-gray-light shadow-lg transition-all",
            "hover:-translate-y-0.5 hover:border-privacy/40 hover:text-foreground",
          )}
        >
          <MessageSquarePlus className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">Feedback</span>
        </button>
      </Dialog.Trigger>

      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/60 backdrop-blur-sm animate-in fade-in-0" />
        <Dialog.Content
          className={cn(
            "fixed left-1/2 top-1/2 z-50 -translate-x-1/2 -translate-y-1/2",
            "max-h-[90vh] w-[92vw] max-w-lg overflow-y-auto rounded-[20px] p-6",
            "border border-gray/30 bg-card",
            "animate-in fade-in-0 zoom-in-95 focus:outline-none",
          )}
        >
          <Dialog.Close asChild>
            <button
              className="absolute right-4 top-4 rounded-full bg-gray/10 p-1.5 text-gray transition-colors hover:bg-gray/20"
              aria-label="Close feedback"
            >
              <X className="h-4 w-4" />
            </button>
          </Dialog.Close>

          <Dialog.Title className="text-body1 font-semibold text-foreground">
            Tell us what&apos;s wrong
          </Dialog.Title>
          <Dialog.Description className="mt-1 mb-4 text-caption text-gray">
            This is a closed beta on testnet. Nothing you break here costs anyone money, so please
            break it and then tell us how.
          </Dialog.Description>

          <FeedbackForm />
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
