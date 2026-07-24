"use client";

import type { ReactNode } from "react";
import { Droplets } from "lucide-react";
import { cn } from "@/lib/utils";
import type { NetworkId } from "@/lib/network-config";
import { PrivateBtcFaucetForm } from "@/components/shield-flow/private-btc-faucet-form";

export function BtcFaucetPrompt({
  networkId,
  tokenSelector,
  className,
}: {
  networkId: NetworkId;
  tokenSelector: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("space-y-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption text-gray">Asset</span>
        {tokenSelector}
      </div>

      <div className="space-y-3 rounded-[12px] border border-warning/20 bg-warning/5 p-4">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 rounded-[9px] bg-warning/10 p-2">
            <Droplets className="h-4 w-4 text-warning" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-body2-semibold text-foreground">Get private test BTC</p>
            <p className="mt-1 text-caption text-gray">
              Test BTC goes through the regtest deposit flow and is credited directly to your private vault. No second deposit is needed.
            </p>
          </div>
        </div>
        <PrivateBtcFaucetForm network={networkId} />
      </div>
    </div>
  );
}
