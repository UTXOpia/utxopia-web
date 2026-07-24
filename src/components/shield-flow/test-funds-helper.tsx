"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ExternalLink, Loader2, RefreshCw } from "lucide-react";
import type { NetworkId } from "@/lib/network-config";

type SplFaucetToken = "USDC" | "USDT";

export function SplTestFundsHelper({
  token,
  networkId,
  recipient,
  onBalanceRefresh,
}: {
  token: SplFaucetToken;
  networkId: NetworkId;
  recipient: string;
  onBalanceRefresh: () => void;
}) {
  const [status, setStatus] = useState<"idle" | "loading" | "success" | "error">("idle");
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    setStatus("idle");
    setMessage(null);
  }, [networkId, recipient, token]);

  async function getTestTokens() {
    setStatus("loading");
    setMessage(null);

    try {
      const response = await fetch(`/api/faucet/spl?network=${encodeURIComponent(networkId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient, token, amount: 10 }),
      });
      const text = await response.text();
      let body: { ok?: boolean; error?: string } = {};

      try {
        body = JSON.parse(text) as { ok?: boolean; error?: string };
      } catch {
        throw new Error(`Faucet returned an invalid response (HTTP ${response.status}).`);
      }

      if (!response.ok || !body.ok) {
        throw new Error(body.error || `Faucet request failed (HTTP ${response.status}).`);
      }

      setStatus("success");
      setMessage(`10 test ${token} was sent to your connected wallet.`);
      onBalanceRefresh();
    } catch (cause) {
      setStatus("error");
      setMessage(cause instanceof Error ? cause.message : `Could not get test ${token}.`);
    }
  }

  if (status === "success") {
    return (
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px]" aria-live="polite">
        <span className="inline-flex items-center gap-1.5 text-success">
          <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
          {message}
        </span>
        <button
          type="button"
          onClick={onBalanceRefresh}
          className="inline-flex min-h-9 items-center gap-1 text-gray-light underline-offset-4 hover:text-foreground hover:underline"
        >
          <RefreshCw className="h-3 w-3" />
          Refresh balance
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-1.5 text-[11px]" aria-live="polite">
      <p className={status === "error" ? "text-red-400" : "text-gray"}>
        {status === "error" ? message : `Not enough test ${token}?`}
        {" "}
        <button
          type="button"
          onClick={getTestTokens}
          disabled={status === "loading"}
          className="inline-flex min-h-9 items-center gap-1 font-semibold text-warning underline-offset-4 hover:underline disabled:cursor-wait disabled:opacity-60"
        >
          {status === "loading" && <Loader2 className="h-3 w-3 animate-spin" />}
          {status === "loading" ? `Getting test ${token}…` : `Get test ${token}`}
        </button>
      </p>
    </div>
  );
}

export function SolTestFundsHelper() {
  return (
    <p className="text-[11px] text-gray">
      Not enough devnet SOL?{" "}
      <a
        href="https://faucet.solana.com/"
        target="_blank"
        rel="noreferrer"
        className="inline-flex min-h-9 items-center gap-1 font-semibold text-sol underline-offset-4 hover:underline"
      >
        Open Solana faucet
        <ExternalLink className="h-3 w-3" />
      </a>
    </p>
  );
}
