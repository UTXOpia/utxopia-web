"use client";

import { type ReactNode } from "react";
import { PlusCircle } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { ShieldFlow } from "@/components/shield-flow";
import { hrefWithChain, type NetworkConfig, type NetworkId } from "@/lib/network-config";

interface ChainDepositRouteProps {
  networkId: NetworkId;
  config: NetworkConfig;
}

export function renderChainDeposit(props: ChainDepositRouteProps): ReactNode {
  return <SolanaDepositPage {...props} />;
}

function SolanaDepositPage({ networkId }: ChainDepositRouteProps) {
  return (
    <FlowPageLayout
      backHref={hrefWithChain("/vault", networkId)}
      backLabel="Back"
      width={520}
      badges={[
        {
          icon: <PlusCircle className="w-full h-full" />,
          label: "Add funds",
          color: "privacy",
        },
      ]}
      titleIcon={<PlusCircle className="w-full h-full" />}
      title="Add Funds"
      description="Move BTC, SOL, or supported tokens into your private balance"
    >
      <ShieldFlow />
    </FlowPageLayout>
  );
}
