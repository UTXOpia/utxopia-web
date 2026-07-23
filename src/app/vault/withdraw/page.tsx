"use client";

import { ArrowUpFromLine } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { CashOutFlow } from "@/components/send/send-flow";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";
import { PRODUCT_COPY } from "@/lib/product-language";

export default function WithdrawPage() {
  const { networkId } = useChainEnvironment();

  return (
    <FlowPageLayout
      backHref={hrefWithChain("/vault", networkId)}
      backLabel="Back"
      width={460}
      badges={[{ icon: <ArrowUpFromLine className="w-full h-full" />, label: PRODUCT_COPY.actions.takeFundsOut, color: "privacy" }]}
      titleIcon={<ArrowUpFromLine className="w-full h-full" />}
      title={PRODUCT_COPY.actions.takeFundsOut}
      description="Cash out supported assets to Solana, or withdraw zkBTC to a native Bitcoin address."
    >
      <CashOutFlow />
    </FlowPageLayout>
  );
}
