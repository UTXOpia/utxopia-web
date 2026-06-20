"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hrefWithChain } from "@/lib/network-config";
import { networkForChain } from "@/lib/chain-registry";
import { useChainEnvironment } from "@/lib/chain-environment";

export default function SuiPage() {
  const router = useRouter();
  const { networkId } = useChainEnvironment();

  useEffect(() => {
    // If Google returned here with a zkLogin token, let ZkLoginCallbackHandler
    // consume it and redirect (it restores chain=sui from `state`). Don't race it.
    if (typeof window !== "undefined") {
      const hash = new URLSearchParams(window.location.hash.replace(/^#/, ""));
      if (hash.get("id_token") || hash.get("error")) return;
    }
    // Plain visit to /sui → open the Sui vault (always the sui chain, never sol).
    router.replace(hrefWithChain("/vault", networkForChain(networkId, "sui")));
  }, [networkId, router]);

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="flex items-center gap-2 text-gray">
        <div className="w-5 h-5 border-2 border-sui border-t-transparent rounded-full animate-spin" />
        <span className="text-body2">Opening Sui vault...</span>
      </div>
    </main>
  );
}
