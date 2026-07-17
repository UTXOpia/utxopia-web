"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowLeft, CheckCircle2, Droplets, Wallet, ExternalLink } from "lucide-react";
import { getChainAdapter, isHybridNetwork } from "@/lib/chain-registry";
import { getNetworkConfig, hrefWithChain, type NetworkId } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { recordAlphaDemoDeposit } from "@/lib/alpha-demo-ledger";
import { recordPendingFaucetActivity } from "@/lib/faucet-activity";
import { cn } from "@/lib/utils";

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
  const [faucetToken, setFaucetToken] = useState<"BTC" | "USDC" | "USDT" | "SUI" | "XUSD">("BTC");
  const { networkId: activeNetwork } = useChainEnvironment();

  useEffect(() => {
    setMounted(true);
  }, []);

  const network = mounted ? activeNetwork : null;
  const config = network ? getNetworkConfig(network, { applyEnvOverrides: false }) : null;
  const chain = config ? getChainAdapter(config) : null;
  const isHybrid = !!network && isHybridNetwork(network);
  const chainHref = (href: string) => network ? hrefWithChain(href, network) : href;
  const isSui = chain?.id === "sui";
  // Sui: SUI/USDC via external faucets + XUSD minted in-app (works on any Sui network,
  // not just hybrid); BTC only on the regtest hybrid stack. Solana mints SPL test tokens.
  const tokenOptions: readonly ("BTC" | "USDC" | "USDT" | "SUI" | "XUSD")[] = isSui
    ? (isHybrid ? ["SUI", "USDC", "XUSD", "BTC"] : ["SUI", "USDC", "XUSD"])
    : ["BTC", "USDC", "USDT"];
  const activeToken = tokenOptions.includes(faucetToken) ? faucetToken : tokenOptions[0];

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
              {activeToken === "BTC" ? "Regtest zkBTC airdrop" : activeToken === "SUI" ? "Get test SUI" : activeToken === "XUSD" ? "Get test XUSD" : `Test ${activeToken} airdrop`}
            </h1>
            <p className="text-caption text-gray">
              {activeToken === "BTC"
                ? isSui
                  ? "Create a local BTC regtest deposit for your Sui vault."
                  : "Deposit 0.001 regtest BTC into a UTXOpia stealth address."
                : activeToken === "SUI"
                  ? "Claim test SUI from the official faucet, then deposit it to your private vault."
                  : activeToken === "XUSD"
                    ? "Mint test XUSD straight to your wallet, then deposit it to go private."
                    : `Send test ${activeToken} to your wallet, then deposit it to your private vault.`}
            </p>
          </div>
        </div>

        {(isHybrid || isSui) && tokenOptions.length > 1 && (
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

        {activeToken === "SUI" ? (
          <SuiFaucetLink network={network} />
        ) : activeToken === "XUSD" ? (
          <SuiXusdFaucetForm network={network} />
        ) : isSui && activeToken === "USDC" ? (
          <SuiUsdcFaucetLink network={network} />
        ) : !isHybrid ? (
          <NotAvailableNotice network={network ?? "unknown"} />
        ) : activeToken === "USDC" || activeToken === "USDT" ? (
          <SplFaucetForm token={activeToken} network={network} />
        ) : (
          <FaucetForm isSui={isSui} network={network} />
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

/** Sui faucet = a link to the official testnet faucet (product decision: no
 *  custom Sui mint). User claims test SUI there, then deposits/shields it here. */
function SuiFaucetLink({ network }: { network: NetworkId }) {
  return (
    <div className="space-y-4">
      <div className="rounded-[12px] border border-sui/25 bg-sui/5 p-4 text-body2 text-gray-light">
        UTXOpia doesn&apos;t mint SUI — claim test SUI from the official Sui faucet, then come
        back and deposit it to go private.
      </div>
      <a
        href="https://faucet.sui.io/?network=testnet"
        target="_blank"
        rel="noreferrer"
        className="btn-primary w-full"
      >
        <Droplets className="w-5 h-5" />
        Open the official Sui faucet
        <ExternalLink className="w-4 h-4" />
      </a>
      <Link
        href={hrefWithChain("/vault/deposit", network)}
        className="inline-flex items-center gap-1.5 text-caption font-medium text-sui hover:text-sui/80"
      >
        Already have SUI? Deposit it <ExternalLink className="w-3 h-3" />
      </Link>
    </div>
  );
}

/** Sui USDC faucet = a link to Circle's faucet (real Circle testnet USDC). */
function SuiUsdcFaucetLink({ network }: { network: NetworkId }) {
  return (
    <div className="space-y-4">
      <div className="rounded-[12px] border border-sui/25 bg-sui/5 p-4 text-body2 text-gray-light">
        UTXOpia uses real Circle USDC on Sui — claim test USDC from Circle&apos;s faucet
        (pick <span className="font-mono text-foreground">Sui Testnet</span>), then deposit it to go private.
      </div>
      <a href="https://faucet.circle.com/" target="_blank" rel="noreferrer" className="btn-primary w-full">
        <Droplets className="w-5 h-5" />
        Open the Circle USDC faucet
        <ExternalLink className="w-4 h-4" />
      </a>
      <Link
        href={hrefWithChain("/vault/deposit", network)}
        className="inline-flex items-center gap-1.5 text-caption font-medium text-sui hover:text-sui/80"
      >
        Already have USDC? Deposit it <ExternalLink className="w-3 h-3" />
      </Link>
    </div>
  );
}

/** XUSD faucet: mints the XUSD demo coin straight to the user's Sui wallet in-app
 *  (relayer-sponsored TreasuryCap mint) — no external faucet. Calls /api/faucet/sui-xusd. */
function SuiXusdFaucetForm({ network }: { network: NetworkId }) {
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState(100);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<{ kind: "ok"; digest: string } | { kind: "err"; message: string } | null>(null);

  useEffect(() => { setResult(null); }, [address, amount]);

  const trimmed = address.trim();
  const validAddress = /^0x[0-9a-fA-F]{64}$/.test(trimmed);
  const invalid = trimmed.length > 0 && !validAddress;

  async function handleDrip() {
    setSubmitting(true);
    setResult(null);
    try {
      const res = await fetch(`/api/faucet/sui-xusd?network=${encodeURIComponent(network)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: trimmed, amount }),
      });
      const body = (await res.json()) as { success: boolean; digest?: string; error?: string };
      if (!res.ok || !body.success) setResult({ kind: "err", message: body.error ?? `HTTP ${res.status}` });
      else setResult({ kind: "ok", digest: body.digest ?? "" });
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
        <label className="text-body2 text-gray-light pl-2 mb-2 block">Your Sui wallet address</label>
        <div className="relative">
          <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray" />
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="Paste your Sui wallet (0x…)"
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
          {invalid ? "Enter a valid Sui address (0x + 64 hex)." : "Test XUSD is minted here; then deposit it to go private."}
        </p>
      </div>

      <div>
        <label className="text-body2 text-gray-light pl-2 mb-2 block">Amount (XUSD)</label>
        <input
          type="number"
          min={1}
          max={1000}
          step={1}
          value={amount}
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
          className={cn(
            "w-full p-3 bg-muted border border-gray/15 rounded-[12px]",
            "text-body2 font-mono text-foreground",
            "outline-none focus:border-warning/40 transition-colors",
          )}
        />
      </div>

      <button onClick={handleDrip} disabled={disabled} className="btn-primary w-full">
        <Droplets className="w-5 h-5" />
        {submitting ? "Minting…" : "Mint test XUSD"}
      </button>

      {result?.kind === "ok" && (
        <div className="rounded-[10px] border border-success/30 bg-success/5 p-3 text-caption text-success break-all">
          Minted {amount} XUSD ✓ — tx {result.digest.slice(0, 12)}…
        </div>
      )}
      {result?.kind === "err" && (
        <div className="rounded-[10px] border border-red-500/30 bg-red-500/5 p-3 text-caption text-red-400 break-words">
          {result.message}
        </div>
      )}

      <Link
        href={hrefWithChain("/vault/deposit", network)}
        className="inline-flex items-center gap-1.5 text-caption font-medium text-sui hover:text-sui/80"
      >
        Got XUSD? Deposit it <ExternalLink className="w-3 h-3" />
      </Link>
    </div>
  );
}

/** USDC/USDT faucet: mint test tokens to the user's public wallet (Solana only),
 *  so they can then deposit/shield them. Calls the native backend SPL faucet via
 *  the /api/faucet/spl proxy. */
function SplFaucetForm({ token, network }: { token: "USDC" | "USDT"; network: NetworkId }) {
  const [address, setAddress] = useState("");
  const [amount, setAmount] = useState(10);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<
    | { kind: "ok"; signature: string; ata?: string }
    | { kind: "err"; message: string }
    | null
  >(null);

  useEffect(() => { setResult(null); }, [address, amount]);

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
            onChange={(e) => setAddress(e.target.value)}
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
          onChange={(e) => setAmount(Number(e.target.value) || 0)}
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
      suiDeposit?: {
        ok: boolean;
        txDigest?: string;
        error?: string;
        commitment?: string;
        root?: string;
      };
    }
  | { kind: "cooldown"; retryAfterSec: number; message: string }
  | { kind: "err"; message: string };

function FaucetForm({ isSui = false, network }: { isSui?: boolean; network: NetworkId }) {
  const [address, setAddress] = useState("");
  const [amountSats, setAmountSats] = useState(100_000);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<DripResult | null>(null);

  useEffect(() => {
    setResult(null);
  }, [address, amountSats]);

  // Prefill the recipient: an explicit ?address= wins, otherwise fall back to
  // the signed-in vault's own stealth address so a logged-in user never has to
  // paste their own address to drip test funds.
  const myStealthAddress = useUTXOpiaStore((s) => s.stealthAddressEncoded);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const initialAddress = params.get("address");
    if (initialAddress) {
      setAddress(initialAddress);
    } else if (myStealthAddress) {
      setAddress((cur) => (cur ? cur : myStealthAddress));
    }
  }, [myStealthAddress]);

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

  const validAddress = /^utxo:[0-9a-fA-F]{192}$/.test(address.trim());
  const hasAddress = address.trim().length > 0;
  const addressInvalid = hasAddress && !validAddress;

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
    setSubmitting(true);
    setResult(null);
    try {
      const params = new URLSearchParams({ network });
      const res = await fetch(`/api/faucet/regtest?${params.toString()}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ address: address.trim(), amountSats }),
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
        suiDeposit?: {
          ok: boolean;
          txDigest?: string;
          error?: string;
          commitment?: string;
          root?: string;
        };
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
          stealthAddress: address.trim(),
          amountSats: body.amountSats ?? amountSats,
          txid: body.txid ?? "",
          opReturn: body.opReturn,
          depositAddress: body.depositAddress,
          blocksMined: body.blocksMined,
        });
        recordAlphaDemoDeposit({
          networkId: network,
          stealthAddress: address.trim(),
          amountSats: body.amountSats ?? amountSats,
          txid: body.txid ?? "",
          opReturn: body.opReturn,
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
          suiDeposit: body.suiDeposit,
        });
      }
    } catch (e) {
      setResult({ kind: "err", message: e instanceof Error ? e.message : String(e) });
    } finally {
      setSubmitting(false);
    }
  }

  const cooldownActive = result?.kind === "cooldown" && cooldownLeft > 0;
  const disabled = !validAddress || submitting || amountSats <= 0 || cooldownActive;

  return (
    <div className="space-y-4">
      <div>
        <label className="text-body2 text-gray-light pl-2 mb-2 block">
          Recipient UTXOpia address
        </label>
        <div className="relative">
          <Wallet className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray" />
          <input
            type="text"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="utxo:..."
            className={cn(
              "w-full p-3 pl-10 bg-muted border border-gray/15 rounded-[12px]",
              "text-body2 font-mono text-foreground placeholder:text-gray",
              "outline-none focus:border-warning/40 transition-colors",
            )}
          />
        </div>
      </div>

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
          onChange={(e) => setAmountSats(Number(e.target.value) || 0)}
          className={cn(
            "w-full p-3 bg-muted border border-gray/15 rounded-[12px]",
            "text-body2 font-mono text-foreground",
            "outline-none focus:border-warning/40 transition-colors",
          )}
        />
        <p className="text-caption text-gray mt-1 pl-2">
          {(amountSats / 1e8).toFixed(8)} BTC. Limit: 3 airdrops per day.
        </p>
      </div>

      {(!validAddress || cooldownActive) && (
        <div className="flex items-start gap-2 rounded-[10px] border border-warning/25 bg-warning/5 p-3 text-caption text-warning">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <div>
            {!hasAddress ? (
              <>
                Open your vault to create a private receive address, or paste a{" "}
                <span className="font-mono">utxo:</span> address here.
                <Link
                  href={hrefWithChain("/vault", network)}
                  className="ml-1 font-semibold underline underline-offset-2"
                >
                  Open vault
                </Link>
              </>
            ) : addressInvalid ? (
              <>Enter a valid UTXOpia address: <span className="font-mono">utxo:</span> plus 192 hex characters.</>
            ) : (
              <>Cooldown active. Try again in {cooldownLeft}s.</>
            )}
          </div>
        </div>
      )}

      <button
        onClick={handleDrip}
        disabled={disabled}
        title={!hasAddress ? "Paste or create a UTXOpia receive address first" : undefined}
        className="btn-primary w-full"
      >
        <Droplets className="w-5 h-5" />
        {submitting
          ? "Creating deposit…"
          : cooldownActive
            ? `Wait ${cooldownLeft}s`
            : "Airdrop zkBTC deposit"}
      </button>

      {result?.kind === "ok" && (
        <div className="space-y-3 rounded-[10px] border border-success/30 bg-success/5 p-3 text-caption text-success">
          <div className="flex items-start gap-2">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
            <div>
              <p className="font-semibold text-success">
                Deposit confirmed{result.blocksMined != null ? ` (${result.blocksMined} block${result.blocksMined === 1 ? "" : "s"} mined)` : ""}
              </p>
              <p className="mt-0.5 text-success/75">
                zkBTC is ready in your private vault.
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
          {isSui && result.opReturn && result.suiDeposit?.ok && (
            <div className="rounded-[8px] border border-sui/25 bg-sui/8 p-2 text-sui">
              Sui vault credited.
              {result.suiDeposit.txDigest && (
                <div className="mt-1 font-mono break-all text-sui/80">{result.suiDeposit.txDigest}</div>
              )}
            </div>
          )}
          {isSui && result.opReturn && !result.suiDeposit?.ok && (
            <div className="mt-2 rounded-[8px] border border-warning/25 bg-warning/8 p-2 text-warning">
              BTC funding is done. Sui vault credit is still waiting on the relayer.
              {result.suiDeposit?.error && (
                <div className="mt-1 font-mono break-all text-warning/80">{result.suiDeposit.error}</div>
              )}
            </div>
          )}
          <div className="flex flex-wrap gap-2 pt-2">
            <Link
              href={hrefWithChain(isSui ? "/vault/activity?result=deposit_btc&refresh=inbox" : "/vault/activity?refresh=inbox", network)}
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
        {isSui
          ? "This creates a regtest BTC deposit and credits the private Sui vault when the local relayer is available."
          : (
            <>
              Share this page with a tester and ask them for their <span className="font-mono">utxo:</span>{" "}
              address. The backend creates the regtest BTC deposit and the tracker credits the note after it sees the transaction.
            </>
          )}
      </p>
    </div>
  );
}
