"use client";

import { type ReactNode } from "react";
import { PlusCircle } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { ShieldFlow } from "@/components/shield-flow";
import { VaultDestinationPicker } from "@/components/vault/vault-destination-picker";
import { ExitGuarantee } from "@/components/vault/exit-guarantee";
import { getNetworkConfig, hrefWithChain, type NetworkConfig, type NetworkId } from "@/lib/network-config";
import { PRODUCT_COPY } from "@/lib/product-language";
import {
  getVaultNetworkConfig,
  getVaultRuntimeConfig,
  hrefWithVault,
  vaultsSupported,
  type VaultId,
} from "@/lib/vault-config";
import type { BtcNetwork } from "@/lib/exit-registry";

interface ChainDepositRouteProps {
  networkId: NetworkId;
  config: NetworkConfig;
  vaultId: VaultId;
}

export function renderChainDeposit(props: ChainDepositRouteProps): ReactNode {
  return <SolanaDepositPage {...props} />;
}

function SolanaDepositPage({ networkId, vaultId }: ChainDepositRouteProps) {
  // Shown here and not in settings: this is where a member first takes on
  // zkBTC, and zkBTC is the one asset they cannot convert back on their own
  // without a registered bitcoin address. Anywhere later is after the fact.
  // `?vault=verified` parses on any network, but the vault configs only exist on
  // the one deployment that has two pools — reading them elsewhere throws and
  // would take the whole deposit page with it.
  const verified = vaultId === "verified" && vaultsSupported(networkId);
  const vault = verified ? getVaultRuntimeConfig(networkId, vaultId) : null;
  const btcNetwork = verified
    ? (getVaultNetworkConfig(networkId, getNetworkConfig(networkId), vaultId)
        .bitcoin.network as BtcNetwork)
    : null;

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
      {vault && btcNetwork && (
        <ExitGuarantee
          programId={vault.programId}
          poolState={vault.poolState}
          btcNetwork={btcNetwork}
        />
      )}
      <ShieldFlow />
    </FlowPageLayout>
  );
}
