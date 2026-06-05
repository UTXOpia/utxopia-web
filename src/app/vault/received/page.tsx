"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { detectNetwork, hrefWithChain } from "@/lib/network-config";

/**
 * Redirect to the unified Notes page (activity) with the claimable tab
 * The received page functionality has been merged into /vault/activity
 */
export default function ReceivedPage() {
  const router = useRouter();

  useEffect(() => {
    router.replace(hrefWithChain("/vault/activity?tab=claimable", detectNetwork()));
  }, [router]);

  // Show a brief loading state while redirecting
  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="flex items-center gap-2 text-gray">
        <div className="w-5 h-5 border-2 border-privacy border-t-transparent rounded-full animate-spin" />
        <span className="text-body2">Redirecting to Notes...</span>
      </div>
    </main>
  );
}
