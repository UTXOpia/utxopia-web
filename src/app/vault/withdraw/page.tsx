"use client";

import { ArrowUpFromLine } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { CashOutFlow } from "@/components/send/send-flow";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter } from "@/lib/chain-registry";
import { hrefWithChain } from "@/lib/network-config";

export default function WithdrawPage() {
  const { networkId, config } = useChainEnvironment();
  const isSui = getChainAdapter(config).id === "sui";

  return (
    <FlowPageLayout
      backHref={hrefWithChain("/vault", networkId)}
      backLabel="Back"
      width={460}
      badges={[{ icon: <ArrowUpFromLine className="w-full h-full" />, label: "Cash out", color: "privacy" }]}
      titleIcon={<ArrowUpFromLine className="w-full h-full" />}
      title="Cash out"
      description={
        isSui
          ? "Release a supported Coin to a public Sui address — or send privately to a name or stealth address."
          : "Send to a Bitcoin address or Solana wallet to move funds out of your private balance."
      }
    >
      <CashOutFlow />
    </FlowPageLayout>
  );
}
