"use client";

import { Inbox, Shield, RefreshCw, Key } from "lucide-react";
import { cn } from "@/lib/utils";

interface EmptyInboxProps {
  hasKeys: boolean;
  onUnlock?: () => void;
  onRefresh?: () => void;
  isLoading?: boolean;
}

export function EmptyInbox({ hasKeys, onUnlock, onRefresh, isLoading }: EmptyInboxProps) {
  if (!hasKeys) {
    return (
      <div className="flex flex-col items-center justify-center py-8 text-center">
        <div className="rounded-full bg-privacy/10 p-4 mb-4">
          <Shield className="h-10 w-10 text-privacy" />
        </div>
        <p className="text-heading6 text-foreground mb-2">Unlock private vault</p>
        <p className="text-body2 text-gray mb-1.5">
          Use a passkey or connected wallet to derive your vault keys
        </p>
        <p className="text-caption text-gray/60 mb-5">
          Your keys never leave your device
        </p>
        <button
          onClick={onUnlock}
          disabled={isLoading}
          className={cn(
            "inline-flex items-center gap-2 px-6 py-3 rounded-[12px]",
            "bg-foreground hover:bg-white",
            "text-body2 text-background font-medium transition-all duration-200 cursor-pointer",
            "hover:shadow-[0_0_24px_rgba(255,255,255,0.12)]"
          )}
        >
          <Key className="w-4 h-4" />
          {isLoading ? "Unlocking..." : "Unlock private vault"}
        </button>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center py-8 text-center">
      <div className="rounded-full bg-gray/10 p-4 mb-4">
        <Inbox className="h-10 w-10 text-gray" />
      </div>
      <p className="text-heading6 text-foreground mb-2">No funds received</p>
      <p className="text-body2 text-gray mb-4">
        Payments to your private address appear here after they are confirmed
      </p>
      {onRefresh && (
        <button
          onClick={onRefresh}
          disabled={isLoading}
          className="flex items-center gap-2 text-body2 text-gray hover:text-gray-light transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? "animate-spin" : ""}`} />
          Refresh
        </button>
      )}
    </div>
  );
}
