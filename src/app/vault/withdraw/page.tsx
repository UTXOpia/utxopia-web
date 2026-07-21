"use client";

import { ArrowUpFromLine } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { CashOutFlow } from "@/components/send/send-flow";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";

export default function WithdrawPage() {
  const { networkId } = useChainEnvironment();

  return (
    <FlowPageLayout
      backHref={hrefWithChain("/vault", networkId)}
      backLabel="Back"
      width={460}
      badges={[{ icon: <ArrowUpFromLine className="w-full h-full" />, label: "Cash out", color: "privacy" }]}
      titleIcon={<ArrowUpFromLine className="w-full h-full" />}
      title="Cash out"
      description="Choose Bitcoin or Solana, then enter the destination address."
    >
      <CashOutFlow />
    </FlowPageLayout>
  );
}
