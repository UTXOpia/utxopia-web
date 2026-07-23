"use client";

import { Send } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { SendFlow } from "@/components/send/send-flow";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";

export default function SendPage() {
  const chainEnv = useChainEnvironment();

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
      title="Send privately"
      description="Send to a UTXOpia name, private receive address, or claim link."
    >
      <SendFlow />
    </FlowPageLayout>
  );
}
