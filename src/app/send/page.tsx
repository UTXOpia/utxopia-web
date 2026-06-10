"use client";

import { Send } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { SendFlow } from "@/components/send/send-flow";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getChainAdapter } from "@/lib/chain-registry";
import { hrefWithChain } from "@/lib/network-config";

export default function SendPage() {
  const chainEnv = useChainEnvironment();
  const isSui = getChainAdapter(chainEnv.config).id === "sui";

  return (
    <FlowPageLayout
      backHref={hrefWithChain("/vault", chainEnv.networkId)}
      backLabel="Back"
      width={460}
      badges={[
        {
          icon: <Send className="w-full h-full" />,
          label: "Send",
          color: "privacy",
        },
      ]}
      titleIcon={<Send className="w-full h-full" />}
      title="Send"
      description={
        isSui
          ? "Send a supported Coin privately to a name or stealth address, or cash out to a 0x Sui address."
          : "Pay a Bitcoin address, Solana wallet, private address, or claim link."
      }
    >
      <SendFlow />
    </FlowPageLayout>
  );
}
