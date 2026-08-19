"use client";

import { Settings as SettingsIcon } from "lucide-react";
import { FlowPageLayout } from "@/components/ui/flow-page-layout";
import { PreferencesForm } from "@/components/settings/preferences-form";
import { LoginSection } from "@/components/settings/login-section";
import { RecoverySection } from "@/components/settings/recovery-section";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";

export default function SettingsPage() {
  const chainEnv = useChainEnvironment();

  return (
    <FlowPageLayout
      backHref={hrefWithChain("/vault", chainEnv.networkId)}
      backLabel="Back"
      width={560}
      badges={[
        {
          icon: <SettingsIcon className="w-full h-full" />,
          label: "Settings",
          color: "privacy",
        },
      ]}
      titleIcon={<SettingsIcon className="w-full h-full" />}
      title="Preferences"
      description="Choose a network, manage your receive name, select a relayer, and configure disclosure."
    >
      <div className="flex flex-col gap-8">
        <PreferencesForm />
        <LoginSection />
        <RecoverySection />
      </div>
    </FlowPageLayout>
  );
}
