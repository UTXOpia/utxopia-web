"use client";

import { type ReactNode } from "react";
import { PlusCircle } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { ShieldFlow } from "@/components/shield-flow";
import { VaultDestinationPicker } from "@/components/vault/vault-destination-picker";
import { hrefWithChain, type NetworkConfig, type NetworkId } from "@/lib/network-config";
import { PRODUCT_COPY } from "@/lib/product-language";
import { hrefWithVault, type VaultId } from "@/lib/vault-config";

interface ChainDepositRouteProps {
  networkId: NetworkId;
  config: NetworkConfig;
  vaultId: VaultId;
}

export function renderChainDeposit(props: ChainDepositRouteProps): ReactNode {
  return <SolanaDepositPage {...props} />;
}

/**
 * The exit-guarantee panel used to sit above the flow, so that a member met the
 * bitcoin-address question at the moment they first took on zkBTC. It asked for
 * a bitcoin address on every deposit including SOL and USDC, where it has
 * nothing to do with what the member is doing, so it is not rendered here for
 * now. <ExitGuarantee /> still exists and gates nothing.
 */
function SolanaDepositPage({ networkId, vaultId }: ChainDepositRouteProps) {
  return (
    <FlowPageLayout
      backHref={hrefWithVault(hrefWithChain("/vault", networkId), vaultId)}
      backLabel="Back"
      width={520}
      badges={[
        {
          icon: <PlusCircle className="w-full h-full" />,
          label: PRODUCT_COPY.actions.addFunds,
          color: "privacy",
        },
      ]}
      titleIcon={<PlusCircle className="w-full h-full" />}
      title={PRODUCT_COPY.actions.addFunds}
      description="Deposit native BTC or shield supported Solana assets into your private vault."
    >
      <VaultDestinationPicker />
      <ShieldFlow />
    </FlowPageLayout>
  );
}
