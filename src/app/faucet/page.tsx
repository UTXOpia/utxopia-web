"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, CheckCircle2, Droplets, ExternalLink } from "lucide-react";
import { isHybridNetwork } from "@/lib/chain-registry";
import { hrefWithChain, type NetworkId } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { cn } from "@/lib/utils";
import { SolanaAddressField } from "@/components/ui/solana-address-field";

type FaucetToken = "USDC" | "USDT";
type FaucetAmounts = Record<FaucetToken, number>;

const FAUCET_PREFERENCES_KEY = "utxopia:faucet-preferences:v1";
const DEFAULT_FAUCET_AMOUNTS: FaucetAmounts = {
  USDC: 10,
  USDT: 10,
};

/**
 * Test SPL faucet. BTC test deposits live directly inside Add funds so the
 * user never has to leave the private-vault funding flow.
 */
export default function FaucetPage() {
  const [mounted, setMounted] = useState(false);
  const [faucetToken, setFaucetToken] = useState<FaucetToken>("USDC");
  const [solanaAddress, setSolanaAddress] = useState("");
  const [amounts, setAmounts] = useState<FaucetAmounts>(DEFAULT_FAUCET_AMOUNTS);
  const { networkId: activeNetwork } = useChainEnvironment();

  useEffect(() => {
    setMounted(true);
    try {
      const saved = JSON.parse(localStorage.getItem(FAUCET_PREFERENCES_KEY) || "{}") as {
        solanaAddress?: string;
        amounts?: Partial<FaucetAmounts>;
      };
      setSolanaAddress(saved.solanaAddress || "");
      setAmounts({
        USDC: saved.amounts?.USDC ?? DEFAULT_FAUCET_AMOUNTS.USDC,
        USDT: saved.amounts?.USDT ?? DEFAULT_FAUCET_AMOUNTS.USDT,
      });
    } catch {
      // Invalid local preferences fall back to safe per-asset defaults.
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(FAUCET_PREFERENCES_KEY, JSON.stringify({ solanaAddress, amounts }));
  }, [amounts, mounted, solanaAddress]);

  const network = mounted ? activeNetwork : null;
  const isHybrid = !!network && isHybridNetwork(network);
  const chainHref = (href: string) => network ? hrefWithChain(href, network) : href;
  const tokenOptions: readonly FaucetToken[] = ["USDC", "USDT"];
  const activeToken = tokenOptions.includes(faucetToken) ? faucetToken : tokenOptions[0];
  const setAmount = (token: FaucetToken, value: number) => {
    setAmounts((current) => ({ ...current, [token]: value }));
  };

  if (!mounted || !network) {
    return (
      <main className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <div className="w-16 h-16 rounded-full border-4 border-gray/15 border-t-warning animate-spin" />
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[480px] mb-4 flex items-center justify-between relative z-10">
        <Link
          href={chainHref("/vault")}
          className="inline-flex items-center gap-2 text-body2 text-gray hover:text-gray-light transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back
        </Link>
        <span className="text-caption text-gray font-mono">
          {network ?? "?"}
        </span>
      </div>

      <div
        className={cn(
          "bg-card border border-solid border-gray/30 p-6",
          "w-[480px] max-w-[calc(100vw-32px)] rounded-[16px]",
          "relative z-10",
        )}
      >
        <div className="flex items-center gap-3 mb-4">
          <div className="p-2 rounded-[10px] bg-warning/10">
            <Droplets className="w-5 h-5 text-warning" />
          </div>
          <div>
            <h1 className="text-heading6 text-foreground">
              Test {activeToken} faucet
            </h1>
            <p className="text-caption text-gray">
              Send test {activeToken} to your Solana wallet.
            </p>
          </div>
        </div>

        {isHybrid && tokenOptions.length > 1 && (
          <div className="mb-4 flex gap-1.5 rounded-[12px] bg-muted p-1">
            {tokenOptions.map((t) => (
              <button
                key={t}
                onClick={() => setFaucetToken(t)}
                className={cn(
                  "flex-1 rounded-[9px] py-2 text-body2 font-semibold transition-colors cursor-pointer",
                  activeToken === t
                    ? "bg-background text-foreground shadow-sm"
                    : "text-gray hover:text-gray-light",
                )}
              >
                {t}
              </button>
            ))}
          </div>
        )}

        {!isHybrid ? (
          <NotAvailableNotice network={network ?? "unknown"} />
        ) : (
          <SplFaucetForm
            token={activeToken}
            network={network}
            address={solanaAddress}
            amount={amounts[activeToken]}
            onAddressChange={setSolanaAddress}
            onAmountChange={(value) => setAmount(activeToken, value)}
          />
        )}
      </div>
    </main>
  );
}

function NotAvailableNotice({ network }: { network?: string }) {
  return (
    <div className="space-y-3">
      <div className="p-4 rounded-[12px] bg-muted border border-gray/15">
        <p className="text-body2 text-gray-light">
          Faucet is only available on a <span className="text-warning font-mono">regtest</span>{" "}
          hybrid stack. The current network is{" "}
          <span className="text-foreground font-mono">{network ?? "unknown"}</span>.
        </p>
      </div>
      <div className="text-caption text-gray space-y-2">
        <p>To switch to the hybrid stack:</p>
        <pre className="bg-background/60 border border-gray/15 rounded-[10px] p-3 overflow-x-auto text-[11px] leading-relaxed">
{`# 1. Start regtest BTC + esplora
docker compose -f docker-compose.regtest.yml up -d

# 2. Switch backend to hybrid (Solana + regtest BTC)
docker compose -f docker-compose.hybrid.yml up --build -d

# 3. Sync the matching env
UTXOPIA_NETWORK=devnet-regtest ./scripts/sync-env.sh`}
        </pre>
        <p className="pt-1">
          Public testnet4 / mainnet users should use{" "}
          <a
            className="text-privacy hover:underline inline-flex items-center gap-1"
            href="https://mempool.space/testnet4/faucet"
            target="_blank"
            rel="noreferrer"
          >
            mempool.space testnet4 faucet <ExternalLink className="w-3 h-3" />
          </a>{" "}
          instead.
        </p>
      </div>
    </div>
  );
}

/** USDC/USDT faucet: mint test tokens to the user's public wallet (Solana only),
 *  so they can then deposit/shield them. Calls the native backend SPL faucet via
 *  the /api/faucet/spl proxy. */
function SplFaucetForm({
  token,
  network,
  address,
  amount,
  onAddressChange,
  onAmountChange,
}: {
  token: "USDC" | "USDT";
  network: NetworkId;
  address: string;
  amount: number;
  onAddressChange: (value: string) => void;
  onAmountChange: (value: number) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; signature: string; ata?: string }
    | { kind: "err"; message: string }
    | null
  >(null);

  useEffect(() => { setResult(null); }, [address, amount, token]);

  const trimmed = address.trim();
  const validAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);
  const invalid = trimmed.length > 0 && !validAddress;

  async function handleDrip() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/faucet/spl?network=${encodeURIComponent(network)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: trimmed, token, amount }),
      });
      const body = (await res.json()) as { ok: boolean; signature?: string; ata?: string; error?: string };
      if (!res.ok || !body.ok) setResult({ kind: "err", message: body.error ?? `HTTP ${res.status}` });
      else setResult({ kind: "ok", signature: body.signature ?? "", ata: body.ata });
    } catch (e) {
      setResult({ kind: "err", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  const disabled = !validAddress || submitting || amount <= 0;

  return (
    <div className="space-y-4">
      <SolanaAddressField
        value={address}
        onChange={onAddressChange}
        label="Your Solana wallet address"
        help={invalid
          ? "Enter a valid Solana address."
          : `Test ${token} is sent here; then shield it to go private.`}
      />

      <div>
        <label className="text-body2 text-gray-light pl-2 mb-2 block">Amount ({token})</label>
        <input
          type="number"
          min={1}
          max={10}
          step={1}
          value={amount}
          onChange={(e) => onAmountChange(Number(e.target.value) || 0)}
          className={cn(
            "w-full p-3 bg-muted border border-gray/15 rounded-[12px]",
            "text-body2 font-mono text-foreground",
            "outline-none focus:border-warning/40 transition-colors",
          )}
        />
      </div>

      <button onClick={handleDrip} disabled={disabled} className="btn-primary w-full">
        <Droplets className="w-5 h-5" />
        {submitting ? "Sending…" : `Send test ${token}`}
      </button>

      {result?.kind === "ok" && (
        <div className="space-y-3 rounded-[10px] border border-success/30 bg-success/5 p-3 text-caption text-success">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold text-success">{amount} {token} sent to your wallet</p>
              <p className="mt-0.5 text-success/75">Now shield it to move it into your private vault.</p>
            </div>
          </div>
          {result.signature && (
            <div className="rounded-[8px] border border-success/10 bg-background/30 p-2 font-mono break-all text-success/80">
              {result.signature}
            </div>
          )}
          <Link
            href={hrefWithChain("/vault/deposit", network)}
            className="inline-flex items-center gap-1.5 font-medium text-success hover:text-success/80"
          >
            Deposit {token} now <ExternalLink className="w-3 h-3" />
          </Link>
        </div>
      )}
      {result?.kind === "err" && (
        <div className="rounded-[10px] border border-red-500/30 bg-red-500/5 p-3 text-caption text-red-400">
          {result.message}
        </div>
      )}
    </div>
  );
}
