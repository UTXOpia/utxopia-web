"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, Droplets, ExternalLink, Wallet } from "lucide-react";
import { isHybridNetwork } from "@/lib/chain-registry";
import { hrefWithChain, type NetworkId } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { recordPendingFaucetActivity } from "@/lib/faucet-activity";
import { cn } from "@/lib/utils";

type FaucetToken = "BTC" | "zkBTC" | "SOL" | "USDC" | "USDT";
type FaucetAmounts = Record<FaucetToken, number>;

const FAUCET_PREFERENCES_KEY = "utxopia:faucet-preferences:v1";
const DEFAULT_FAUCET_AMOUNTS: FaucetAmounts = {
  BTC: 100_000,
  zkBTC: 100_000,
  SOL: 0.1,
  USDC: 10,
  USDT: 10,
};

/**
 * Regtest BTC faucet. Only renders when the active network's BTC layer is
 * `regtest` (i.e. the hybrid stack). On testnet4 / mainnet the page shows a
 * "not available on this network" hint instead of a working form, so the
 * route is safe to merge even before the backend wiring lands.
 *
 * Backend wiring lives at `/api/faucet/regtest`.
 */
export default function FaucetPage() {
  const [mounted, setMounted] = useState(false);
  const [faucetToken, setFaucetToken] = useState<FaucetToken>("zkBTC");
  const [solanaAddress, setSolanaAddress] = useState("");
  const [btcAddress, setBtcAddress] = useState("");
  const [amounts, setAmounts] = useState<FaucetAmounts>(DEFAULT_FAUCET_AMOUNTS);
  const { networkId: activeNetwork } = useChainEnvironment();

  useEffect(() => {
    setMounted(true);
    try {
      const saved = JSON.parse(localStorage.getItem(FAUCET_PREFERENCES_KEY) || "{}") as {
        solanaAddress?: string;
        btcAddress?: string;
        amounts?: Partial<FaucetAmounts>;
      };
      setSolanaAddress(saved.solanaAddress || "");
      setBtcAddress(saved.btcAddress || "");
      setAmounts({ ...DEFAULT_FAUCET_AMOUNTS, ...saved.amounts });
    } catch {
      // Invalid local preferences fall back to safe per-asset defaults.
    }
  }, []);

  useEffect(() => {
    if (!mounted) return;
    localStorage.setItem(FAUCET_PREFERENCES_KEY, JSON.stringify({ solanaAddress, btcAddress, amounts }));
  }, [amounts, btcAddress, mounted, solanaAddress]);

  const network = mounted ? activeNetwork : null;
  const isHybrid = !!network && isHybridNetwork(network);
  const chainHref = (href: string) => network ? hrefWithChain(href, network) : href;
  // Solana mints SPL test tokens; BTC only on the regtest hybrid stack.
  const tokenOptions: readonly FaucetToken[] = ["BTC", "zkBTC", "SOL", "USDC", "USDT"];
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
              {activeToken === "zkBTC" ? "Deposit BTC for zkBTC" : `Test ${activeToken} faucet`}
            </h1>
            <p className="text-caption text-gray">
              {activeToken === "zkBTC"
                ? "Create a 0.001 regtest BTC deposit for your private vault."
                : activeToken === "BTC"
                  ? "Send native regtest BTC to your BTC wallet."
                  : `Send test ${activeToken} to your Solana wallet.`}
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
        ) : activeToken === "SOL" ? (
          <OfficialSolFaucet address={solanaAddress} onAddressChange={setSolanaAddress} />
        ) : activeToken === "USDC" || activeToken === "USDT" ? (
          <SplFaucetForm
            token={activeToken}
            network={network}
            address={solanaAddress}
            amount={amounts[activeToken]}
            onAddressChange={setSolanaAddress}
            onAmountChange={(value) => setAmount(activeToken, value)}
          />
        ) : activeToken === "BTC" ? (
          <NativeBtcFaucetForm
            network={network}
            address={btcAddress}
            amountSats={amounts.BTC}
            onAddressChange={setBtcAddress}
            onAmountChange={(value) => setAmount("BTC", value)}
          />
        ) : (
          <FaucetForm
            network={network}
            amountSats={amounts.zkBTC}
            onAmountChange={(value) => setAmount("zkBTC", value)}
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

# 2. Switch backend to hybrid (Solana or Sui + regtest BTC)
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

function OfficialSolFaucet({
  address,
  onAddressChange,
}: {
  address: string;
  onAddressChange: (value: string) => void;
}) {
  const trimmed = address.trim();
  const validAddress = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(trimmed);

  return (
    <div className="space-y-4">
      <div>
        <label className="text-body2 text-gray-light pl-2 mb-2 block">Your Solana wallet address</label>
        <div className="relative">
          <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray" />
          <input
            value={address}
            onChange={(event) => onAddressChange(event.target.value)}
            placeholder="Paste your Solana wallet (base58)"
            spellCheck={false}
            className={cn(
              "w-full p-3 pl-10 bg-muted border rounded-[12px] text-body2 font-mono text-foreground",
              "placeholder:text-gray outline-none transition-colors",
              address && !validAddress ? "border-error/40" : "border-gray/15 focus:border-warning/40",
            )}
          />
        </div>
        <p className="text-caption text-gray mt-1 pl-2">This address is reused for SOL, USDC, and USDT.</p>
      </div>
      <a
        href="https://faucet.solana.com/"
        target="_blank"
        rel="noreferrer"
        className="btn-primary w-full"
        aria-disabled={!validAddress}
        onClick={(event) => {
          if (!validAddress) {
            event.preventDefault();
            return;
          }
          void navigator.clipboard.writeText(trimmed);
        }}
      >
        <ExternalLink className="w-5 h-5" />
        Copy address and open Solana Faucet
      </a>
      <p className="text-caption text-gray">
        SOL is provided by the Solana Foundation devnet Faucet. Paste the copied address there to request an airdrop.
      </p>
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
      <div>
        <label className="text-body2 text-gray-light pl-2 mb-2 block">Your Solana wallet address</label>
        <div className="relative">
          <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray" />
          <input
            type="text"
            value={address}
            onChange={(e) => onAddressChange(e.target.value)}
            placeholder="Paste your Solana wallet (base58)"
            spellCheck={false}
            className={cn(
              "w-full p-3 pl-10 bg-muted border rounded-[12px]",
              "text-body2 font-mono text-foreground placeholder:text-gray",
              "outline-none transition-colors",
              invalid ? "border-red-500/40 focus:border-red-500/60" : "border-gray/15 focus:border-warning/40",
            )}
          />
        </div>
        <p className={cn("text-caption mt-1 pl-2", invalid ? "text-red-400" : "text-gray")}>
          {invalid ? "Enter a valid Solana address." : `Test ${token} is sent here; then deposit it to go private.`}
        </p>
      </div>

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
              <p className="mt-0.5 text-success/75">Now deposit it to move it into your private vault.</p>
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

function NativeBtcFaucetForm({
  network,
  address,
  amountSats,
  onAddressChange,
  onAmountChange,
}: {
  network: NetworkId;
  address: string;
  amountSats: number;
  onAddressChange: (value: string) => void;
  onAmountChange: (value: number) => void;
}) {
  const { config } = useChainEnvironment();
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; txid: string; blocksMined?: number }
    | { kind: "err"; message: string }
    | null
  >(null);
  const trimmed = address.trim();
  const validAddress = /^bcrt1[0-9a-z]{38,90}$/.test(trimmed);

  useEffect(() => { setResult(null); }, [address, amountSats]);

  async function handleDrip() {
    setSubmitting(true);
    setResult(null);
    try {
      const response = await fetch(`/api/faucet/btc?network=${encodeURIComponent(network)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: trimmed, amountSats }),
      });
      const body = await response.json() as {
        ok?: boolean;
        txid?: string;
        blocksMined?: number;
        error?: string;
      };
      if (!response.ok || !body.ok) {
        setResult({ kind: "err", message: body.error || `HTTP ${response.status}` });
      } else {
        setResult({ kind: "ok", txid: body.txid || "", blocksMined: body.blocksMined });
      }
    } catch (error) {
      setResult({ kind: "err", message: error instanceof Error ? error.message : String(error) });
    } finally {
      setSubmitting(false);
    }
  }

  const txUrl = result?.kind === "ok" && result.txid
    ? `${config.bitcoin.explorerUrl.replace(/\/$/, "")}/tx/${result.txid}`
    : null;

  return (
    <div className="space-y-4">
      <div>
        <label className="text-body2 text-gray-light pl-2 mb-2 block">Your regtest BTC address</label>
        <input
          value={address}
          onChange={(event) => onAddressChange(event.target.value)}
          placeholder="bcrt1…"
          spellCheck={false}
          className={cn(
            "w-full p-3 bg-muted border rounded-[12px] text-body2 font-mono text-foreground",
            "placeholder:text-gray outline-none transition-colors",
            address && !validAddress ? "border-error/40 focus:border-error/60" : "border-gray/15 focus:border-warning/40",
          )}
        />
      </div>
      <div>
        <label className="text-body2 text-gray-light pl-2 mb-2 block">Amount (sats)</label>
        <input
          type="number"
          min={1}
          max={100_000}
          step={1_000}
          value={amountSats}
          onChange={(event) => onAmountChange(Number(event.target.value) || 0)}
          className="w-full p-3 bg-muted border border-gray/15 rounded-[12px] text-body2 font-mono text-foreground outline-none focus:border-warning/40"
        />
      </div>
      <button
        onClick={handleDrip}
        disabled={!validAddress || amountSats <= 0 || submitting}
        className="btn-primary w-full"
      >
        <Droplets className="w-5 h-5" />
        {submitting ? "Sending BTC…" : "Send test BTC"}
      </button>
      {result?.kind === "ok" && (
        <div className="rounded-[10px] border border-success/30 bg-success/5 p-3 text-caption text-success">
          <p className="font-semibold">BTC sent{result.blocksMined ? ` and confirmed in ${result.blocksMined} blocks` : ""}</p>
          {txUrl && <a href={txUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex items-center gap-1.5 hover:text-success/80">
            View Bitcoin transaction <ExternalLink className="w-3 h-3" />
          </a>}
        </div>
      )}
      {result?.kind === "err" && (
        <div className="rounded-[10px] border border-error/30 bg-error/5 p-3 text-caption text-error">{result.message}</div>
      )}
    </div>
  );
}

type DripResult =
  | {
      kind: "ok";
      txid: string;
      blocksMined?: number;
      warning?: string;
      depositAddress?: string;
      opReturn?: string;
      amountSats?: number;
      dailyLimit?: number;
    }
  | { kind: "cooldown"; retryAfterSec: number; message: string }
  | { kind: "err"; message: string };

function FaucetForm({
  network,
  amountSats,
  onAmountChange,
}: {
  network: NetworkId;
  amountSats: number;
  onAmountChange: (value: number) => void;
}) {
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DripResult | null>(null);
  const stealthAddress = useUTXOpiaStore((s) => s.stealthAddressEncoded);

  useEffect(() => {
    setResult(null);
  }, [amountSats, stealthAddress]);

  // Live cooldown countdown so the user sees the seconds tick down.
  const [cooldownLeft, setCooldownLeft] = useState(0);
  useEffect(() => {
    if (result?.kind !== "cooldown") {
      setCooldownLeft(0);
      return;
    }
    setCooldownLeft(result.retryAfterSec);
    const iv = setInterval(() => {
      setCooldownLeft((s) => (s > 0 ? s - 1 : 0));
    }, 1000);
    return () => clearInterval(iv);
  }, [result]);

  const hasVault = Boolean(stealthAddress && /^utxo:[0-9a-fA-F]{192}$/.test(stealthAddress));

  async function mineMissingConfirmations(blocksAlreadyMined?: number): Promise<void> {
    const blocks = Math.max(0, 6 - Math.max(0, Number(blocksAlreadyMined ?? 0)));
    if (blocks === 0) return;
    try {
      await fetch(`/api/regtest/mine?network=${encodeURIComponent(network)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blocks }),
      });
    } catch (e) {
      console.warn("[Faucet] Follow-up regtest mining failed:", e);
    }
  }

  async function handleDrip() {
    if (!stealthAddress) return;
    setSubmitting(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ network });
      const res = await fetch(`/api/faucet/regtest?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ asset: "zkBTC", stealthAddress, amountSats }),
      });
      const body = (await res.json()) as {
        ok: boolean;
        txid?: string;
        blocksMined?: number;
        warning?: string;
        depositAddress?: string;
        opReturn?: string;
        amountSats?: number;
        dailyLimit?: number;
        retryAfterSec?: number;
        error?: string;
      };
      if (res.status === 429 && typeof body.retryAfterSec === "number") {
        setResult({
          kind: "cooldown",
          retryAfterSec: body.retryAfterSec,
          message: body.error ?? `Cooldown active. Try again in ${body.retryAfterSec}s.`,
        });
      } else if (!res.ok || !body.ok) {
        setResult({ kind: "err", message: body.error ?? `HTTP ${res.status}` });
      } else {
        recordPendingFaucetActivity({
          networkId: network,
          stealthAddress,
          amountSats: body.amountSats ?? amountSats,
          txid: body.txid ?? "",
          opReturn: body.opReturn,
          depositAddress: body.depositAddress,
          blocksMined: body.blocksMined,
        });
        void mineMissingConfirmations(body.blocksMined).finally(() => {
          void useUTXOpiaStore.getState().refreshInbox(undefined, true);
        });
        setResult({
          kind: "ok",
          txid: body.txid ?? "",
          blocksMined: body.blocksMined,
          warning: body.warning,
          depositAddress: body.depositAddress,
          opReturn: body.opReturn,
          amountSats: body.amountSats,
          dailyLimit: body.dailyLimit,
        });
      }
    } catch (e) {
      setResult({ kind: "err", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  const cooldownActive = result?.kind === "cooldown" && cooldownLeft > 0;
  const disabled = !hasVault || submitting || amountSats <= 0 || cooldownActive;

  return (
    <div className="space-y-4">
      <div>
        <label className="text-body2 text-gray-light pl-2 mb-2 block">
          Amount (sats)
        </label>
        <input
          type="number"
          min={1}
          max={100_000}
          step={1000}
          value={amountSats}
          onChange={(e) => onAmountChange(Number(e.target.value) || 0)}
          className={cn(
            "w-full p-3 bg-muted border border-gray/15 rounded-[12px]",
            "text-body2 font-mono text-foreground",
            "outline-none focus:border-warning/40 transition-colors",
          )}
        />
        <p className="text-caption text-gray mt-1 pl-2">
          {(amountSats / 1e8).toFixed(8)} BTC. Limit: 3 deposits per day.
        </p>
      </div>

      {(!hasVault || cooldownActive) && (
        <div className="flex items-start gap-2 rounded-[10px] border border-warning/25 bg-warning/5 p-3 text-caption text-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {!hasVault ? (
              <>
                Open your vault once to initialize its private deposit identity.
                <Link
                  href={hrefWithChain("/vault", network)}
                  className="ml-1 font-semibold underline underline-offset-2"
                >
                  Open vault
                </Link>
              </>
            ) : (
              <>Cooldown active. Try again in {cooldownLeft}s.</>
            )}
          </div>
        </div>
      )}

      <button
        onClick={handleDrip}
        disabled={disabled}
        title={!hasVault ? "Initialize your private vault first" : undefined}
        className="btn-primary w-full"
      >
        <Droplets className="w-5 h-5" />
        {submitting
          ? "Creating deposit..."
          : cooldownActive
            ? `Wait ${cooldownLeft}s`
            : "Deposit regtest BTC"}
      </button>

      {result?.kind === "ok" && (
        <div className="space-y-3 rounded-[10px] border border-success/30 bg-success/5 p-3 text-caption text-success">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold text-success">
                Deposit broadcast{result.blocksMined != null ? ` (${result.blocksMined} block${result.blocksMined === 1 ? "" : "s"} mined)` : ""}
              </p>
              <p className="mt-0.5 text-success/75">
                The tracker will add zkBTC after it indexes the Bitcoin transaction.
              </p>
            </div>
          </div>
          <div className="rounded-[8px] border border-success/10 bg-background/30 p-2 font-mono break-all text-success/80">
            {result.txid || "(see backend log)"}
          </div>
          {result.depositAddress && (
            <div className="text-success/75">
              Pool address: <span className="font-mono break-all">{result.depositAddress}</span>
            </div>
          )}
          {result.opReturn && (
            <div className="text-success/75">
              OP_RETURN: <span className="font-mono break-all">{result.opReturn}</span>
            </div>
          )}
          {result.warning && (
            <div className="text-warning pt-1 border-t border-success/10">{result.warning}</div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Link
              href={hrefWithChain("/vault/activity?refresh=inbox", network)}
              className="inline-flex items-center justify-center rounded-[8px] border border-success/25 px-3 py-2 text-[11px] font-semibold text-success transition-colors hover:bg-success/10"
            >
              View activity
            </Link>
            <Link
              href={hrefWithChain("/vault", network)}
              className="inline-flex items-center justify-center rounded-[8px] border border-gray/15 px-3 py-2 text-[11px] font-semibold text-gray-light transition-colors hover:border-success/25 hover:text-success"
            >
              Back to vault
            </Link>
          </div>
        </div>
      )}
      {result?.kind === "cooldown" && (
        <div className="p-3 rounded-[10px] border border-warning/30 bg-warning/5 text-caption text-warning">
          {cooldownLeft > 0 ? `Cooldown active. Try again in ${cooldownLeft}s.` : "Cooldown cleared. Try again."}
        </div>
      )}
      {result?.kind === "err" && (
        <div className="p-3 rounded-[10px] border border-error/30 bg-error/5 text-caption text-error">
          {result.message}
        </div>
      )}

      <p className="text-caption text-gray">
        This spends from the regtest faucet wallet, creates the pool output and OP_RETURN metadata, then broadcasts the deposit on Bitcoin.
      </p>
    </div>
  );
}
