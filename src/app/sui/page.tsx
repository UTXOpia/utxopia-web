"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { hrefWithChain } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";

export default function SuiPage() {
  const router = useRouter();
  const { networkId } = useChainEnvironment();

  useEffect(() => {
    router.replace(hrefWithChain("/vault", networkId));
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
