"use client";

import { Send } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { SendFlow } from "@/components/send/send-flow";
import { VaultSourcePicker } from "@/components/vault/vault-destination-picker";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";
import { PRODUCT_COPY } from "@/lib/product-language";

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
          label: PRODUCT_COPY.actions.sendPrivately,
          color: "privacy",
        },
      ]}
      titleIcon={<Send className="w-full h-full" />}
      title={PRODUCT_COPY.actions.sendPrivately}
      description="Send to a UTXOpia name, private receive address, or claim link."
    >
      <VaultSourcePicker />
      <SendFlow />
    </FlowPageLayout>
  );
}
