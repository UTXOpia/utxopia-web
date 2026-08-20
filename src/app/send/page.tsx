"use client";

import { Send } from "lucide-react";
import { AuthModal } from "@/components/auth-modal";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { SendFlow } from "@/components/send/send-flow";
import { VaultSourcePicker } from "@/components/vault/vault-destination-picker";
import { usePayFlowAuth } from "@/hooks/use-pay-flow-auth";
import { useUTXOpiaKeys } from "@/hooks/use-utxopia";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";
import { PRODUCT_COPY } from "@/lib/product-language";

export default function SendPage() {
  const chainEnv = useChainEnvironment();
  const { hasKeys } = useUTXOpiaKeys();
  // Nothing on this page works without keys — the balance reads "Sign in to
  // view", every amount is unaffordable and the button never enables. Showing
  // the whole form first and explaining afterwards is the wrong order, and this
  // hook exists for exactly the flow somebody came to in order to spend.
  const auth = usePayFlowAuth(hasKeys);

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
      <AuthModal
        open={auth.authModalOpen}
        onOpenChange={auth.setAuthModalOpen}
        auth={{ error: auth.passkeyError }}
      />
    </FlowPageLayout>
  );
}
