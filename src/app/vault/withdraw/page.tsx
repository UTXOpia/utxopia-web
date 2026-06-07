"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowUpFromLine } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { SuiUnshieldFlow } from "@/components/send/sui-unshield-flow";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter } from "@/lib/chain-registry";
import { hrefWithChain } from "@/lib/network-config";

export default function WithdrawPage() {
  const router = useRouter();
  const { networkId, config } = useChainEnvironment();
  const chainId = getChainAdapter(config).id;

  // Solana cash-out lives in the unified send flow.
  useEffect(() => {
    if (chainId !== "sui") router.replace(hrefWithChain("/send", networkId));
  }, [chainId, networkId, router]);

  if (chainId !== "sui") return null;

  return (
    <FlowPageLayout
      backHref={hrefWithChain("/vault", networkId)}
      backLabel="Back"
      width={460}
      badges={[{ icon: <ArrowUpFromLine className="w-full h-full" />, label: "Cash out", color: "privacy" }]}
      titleIcon={<ArrowUpFromLine className="w-full h-full" />}
      title="Cash out"
      description="Release a supported Coin from your private balance to a public Sui address."
    >
      <SuiUnshieldFlow />
    </FlowPageLayout>
  );
}
