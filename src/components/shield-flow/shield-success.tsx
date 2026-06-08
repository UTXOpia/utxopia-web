"use client";

import { CheckCircle2, ExternalLink } from "lucide-react";
import type { WalletDepositResult } from "@/hooks/use-btc-deposit";
import { getMempoolExplorerUrl } from "@/lib/btc-network";
import { DepositStatusTracker } from "@/components/shield-flow/deposit-status-tracker";
import { getChainLinkClass, getChainTransactionUrl } from "@/lib/chain-links";
import { cn } from "@/lib/utils";
import type { SHIELD_TOKENS } from "@/lib/supported-tokens";
import { useChainEnvironment } from "@/lib/chain-environment";

type ShieldToken = (typeof SHIELD_TOKENS)[number];

interface ShieldSuccessProps {
  className?: string;
  selectedToken: ShieldToken;
  txSig: string | null;
  walletDepositResult: WalletDepositResult | null;
  onReset: () => void;
}

export function ShieldSuccess({
  className,
  selectedToken,
  txSig,
  walletDepositResult,
  onReset,
}: ShieldSuccessProps) {
  const isBtc = selectedToken.isBtcNative;
  const { config, networkId } = useChainEnvironment();

  return (
    <div className={cn("space-y-4 text-center py-6", className)}>
      <div className={cn("inline-flex p-3 rounded-full border", isBtc ? "bg-btc/10 border-btc/20" : "bg-privacy/10 border-privacy/20")}>
        <CheckCircle2 className={cn("w-8 h-8", isBtc ? "text-btc" : "text-privacy")} />
      </div>
      <h3 className="text-lg font-semibold text-foreground">
        {isBtc ? "BTC deposit submitted" : "Funds added privately"}
      </h3>
      <p className="text-caption text-gray">
        {isBtc && walletDepositResult
          ? "Your BTC deposit was broadcast. It will appear in your private balance after confirmation."
          : `Your ${selectedToken.symbol} is now in your private balance.`}
      </p>
      {isBtc && walletDepositResult?.opReturnHex && (
        <DepositStatusTracker opReturnHex={walletDepositResult.opReturnHex} className="pt-1" />
      )}
      {txSig && (
        <a
          href={getChainTransactionUrl(config, txSig, networkId)}
          target="_blank"
          rel="noreferrer"
          className={cn("inline-flex items-center gap-1.5 text-caption transition-colors", getChainLinkClass(config))}
        >
          View transaction <ExternalLink className="w-3 h-3" />
        </a>
      )}
      {walletDepositResult?.txid && (
        <a
          href={`${getMempoolExplorerUrl(networkId)}/tx/${walletDepositResult.txid}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex items-center gap-1.5 text-caption text-btc hover:text-btc/80 transition-colors"
        >
          View on mempool.space <ExternalLink className="w-3 h-3" />
        </a>
      )}
      <div className="pt-2">
        <button
          onClick={onReset}
          className="px-5 py-2 rounded-[10px] bg-muted border border-gray/15 text-body2 text-gray-light hover:text-foreground hover:bg-muted/80 transition-colors cursor-pointer"
        >
          Add more funds
        </button>
      </div>
    </div>
  );
}
