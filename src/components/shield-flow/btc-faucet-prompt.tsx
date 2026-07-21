"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { Droplets } from "lucide-react";
import { cn } from "@/lib/utils";
import { hrefWithChain, type NetworkId } from "@/lib/network-config";

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
            <p className="text-body2-semibold text-foreground">Get test BTC from the faucet</p>
            <p className="mt-1 text-caption text-gray">
              Open the faucet for the active Bitcoin test network and follow the deposit instructions there.
            </p>
          </div>
        </div>
        <Link
          href={hrefWithChain("/faucet", networkId)}
          className="inline-flex min-h-11 w-full items-center justify-center gap-2 rounded-[10px] bg-warning px-4 text-body2 font-semibold text-background transition-opacity hover:opacity-90"
        >
          <Droplets className="h-4 w-4" />
          Go to BTC faucet
        </Link>
      </div>
    </div>
  );
}
