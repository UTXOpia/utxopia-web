"use client";

import { useEffect, useMemo, useState } from "react";
import { Shield } from "lucide-react";
import { cn } from "@/lib/utils";
import { StealthRecipientInput } from "@/components/ui/stealth-recipient-input";
import { useSuiShield, type SuiShieldToken } from "@/hooks/sui/use-sui-shield";
import { networkForChain } from "@/lib/chain-registry";
import { makeSuiExplorerLinks } from "@/lib/chain-links";
import { getNetworkConfig } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { useUTXOpiaStore } from "@/stores";
import {
  SuiFlowError,
  SuiFlowSuccess,
  SuiSubmitButton,
  SuiTokenAmountField,
  SuiTokensEmpty,
  SuiTokensLoading,
} from "@/components/sui/flow-kit";
import type { StealthMetaAddress } from "@utxopia/sdk";

interface SuiShieldFlowProps {
  /** Connected Sui wallet address (funds the shield + pays gas). */
  walletAddress: string | null;
  className?: string;
}

export function SuiShieldFlow({ walletAddress, className }: SuiShieldFlowProps) {
  const stealthAddress = useUTXOpiaStore((s) => s.stealthAddress);
  const { networkId } = useChainEnvironment();
  const suiNetwork = networkForChain(networkId, "sui");
  const { tokens, loadingTokens, status, error, txDigest, shield, reset } = useSuiShield(walletAddress);

  const [selected, setSelected] = useState<SuiShieldToken | null>(null);
  const [amount, setAmount] = useState("");
  const [resolvedMeta, setResolvedMeta] = useState<StealthMetaAddress | null>(null);
  const [resolvedName, setResolvedName] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!selected && tokens.length > 0) setSelected(tokens[0]);
    if (selected) {
      const refreshed = tokens.find((t) => t.coinType === selected.coinType);
      if (refreshed && refreshed.walletBalance !== selected.walletBalance) setSelected(refreshed);
    }
  }, [tokens, selected]);

  const decimals = selected?.decimals ?? 9;
  const walletBalanceDisplay = useMemo(() => {
    if (!selected) return "";
    return (Number(selected.walletBalance) / 10 ** decimals).toLocaleString(undefined, {
      maximumFractionDigits: Math.min(decimals, 6),
    });
  }, [selected, decimals]);

  const handleShield = async () => {
    if (!selected || !amount || !resolvedMeta) return;
    setFormError(null);
    const amountRaw = BigInt(Math.floor(parseFloat(amount) * 10 ** decimals));
    if (amountRaw < selected.minDeposit) {
      setFormError(`Below the minimum shield amount for ${selected.symbol}`);
      return;
    }
    if (selected.maxDeposit > 0n && amountRaw > selected.maxDeposit) {
      setFormError(`Above the maximum shield amount for ${selected.symbol}`);
      return;
    }
    await shield(selected, amountRaw);
  };

  if (status === "done" && selected) {
    const explorer = makeSuiExplorerLinks(
      getNetworkConfig(suiNetwork, { applyEnvOverrides: false }).sui?.explorerUrl ?? "",
      suiNetwork,
    );
    return (
      <SuiFlowSuccess
        className={className}
        title="Funds added privately"
        subtitle={`Your ${selected.symbol} is now in your private balance.`}
        txHref={txDigest ? explorer.tx(txDigest) : null}
        resetLabel="Add more funds"
        onReset={() => {
          reset();
          setAmount("");
        }}
      />
    );
  }

  if (loadingTokens && tokens.length === 0) return <SuiTokensLoading className={className} />;

  if (tokens.length === 0) {
    return (
      <SuiTokensEmpty className={cn("flex flex-col items-center py-10", className)}>
        <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-full border border-sui/20 bg-sui/10">
          <Shield className="h-5 w-5 text-sui" />
        </div>
        <p className="text-body2-semibold text-foreground">No tokens registered yet</p>
        <p className="mt-1 max-w-[280px] text-caption text-gray">
          An admin must register a Coin type before it can be shielded on Sui.
        </p>
      </SuiTokensEmpty>
    );
  }

  const shownError = formError || error;
  const canSubmit = !!selected && !!amount && parseFloat(amount) > 0 && !!resolvedMeta && !!walletAddress;

  return (
    <div className={cn("space-y-5", className)}>
      <SuiTokenAmountField
        tokens={tokens}
        selected={selected}
        onSelect={setSelected}
        amount={amount}
        onAmount={setAmount}
        balanceLabel={
          walletAddress
            ? selected
              ? `Balance: ${walletBalanceDisplay} ${selected.symbol}`
              : ""
            : "Connect a Sui wallet"
        }
        maxBaseUnits={selected?.walletBalance ?? 0n}
        decimals={decimals}
        showTokenBalances
      />

      <StealthRecipientInput
        onResolved={(meta, name) => {
          setResolvedMeta(meta);
          setResolvedName(name);
        }}
        resolvedMeta={resolvedMeta}
        resolvedName={resolvedName}
        error={formError}
        onError={setFormError}
        label="Private destination"
        selfMeta={stealthAddress ?? null}
        defaultToSelf
      />

      {shownError && status !== "processing" && <SuiFlowError message={shownError} />}

      <SuiSubmitButton
        busy={status === "processing"}
        canSubmit={canSubmit}
        busyLabel="Adding..."
        idleLabel={`Add ${selected?.symbol ?? ""} privately`}
        idleIcon={<Shield className="h-4 w-4" />}
        onClick={handleShield}
      />
    </div>
  );
}
