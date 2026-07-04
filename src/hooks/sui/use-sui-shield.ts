"use client";

/**
 * useSuiShield — Sui generic `Coin<T>` shield.
 *
 * Reads the admin-curated token registry, joins it against the connected
 * wallet's `Coin<T>` balances, and shields a chosen amount through the adapter's
 * single-PTB `buildShieldTokenTransaction` (one wallet signature, no approve).
 */

import { useCallback, useEffect, useState } from "react";
import { Transaction } from "@mysten/sui/transactions";
import { UTXOpiaClient } from "@utxopia/sdk";
import { deriveSuiTokenId, fetchSuiEnabledTokens, type SuiSupportedToken } from "@utxopia/sdk/sui";
import { networkForChain } from "@/lib/chain-registry";
import { getNetworkConfig } from "@/lib/network-config";
import { useChainEnvironment } from "@/lib/chain-environment";
import {
  getBrowserSuiWallet,
  getSuiAdapter,
  getSuiClient,
  signAndExecuteSuiTransaction,
} from "@/lib/sui/client";

/** A registered token enriched with the connected wallet's live balance. */
export interface SuiShieldToken extends SuiSupportedToken {
  /** Display symbol (from on-chain CoinMetadata config, fallback to type tail). */
  symbol: string;
  name: string;
  logo?: string;
  /** Connected wallet's total `Coin<T>` balance (native units). */
  walletBalance: bigint;
}

export type SuiShieldStatus = "idle" | "processing" | "done" | "error";
const TOKEN_REGISTRY_TIMEOUT_MS = 3_000;

interface SuiCoinObject {
  coinObjectId: string;
  version: string;
  digest: string;
  balance: string;
}

function coinTypeTail(coinType: string): string {
  const parts = coinType.split("::");
  return parts[parts.length - 1] ?? coinType;
}

function inferDemoDecimals(symbol: string): number {
  const normalized = symbol.toUpperCase();
  if (normalized === "SUI") return 9;
  if (normalized === "USDC" || normalized === "USDT" || normalized === "XUSD" || normalized === "DUSD") {
    return 6;
  }
  return 9;
}

function fallbackTokensFromConfig(cfg: ReturnType<typeof getNetworkConfig>): SuiShieldToken[] {
  const meta = cfg.sui?.coinMetadata ?? {};
  return Object.entries(meta).map(([coinType, m]) => {
    const decimals = inferDemoDecimals(m.symbol);
    return {
      coinType,
      tokenId: deriveSuiTokenId(coinType),
      decimals,
      enabled: true,
      minDeposit: 1n,
      maxDeposit: 1_000_000_000_000_000n,
      depositCap: 1_000_000_000_000_000n,
      totalShielded: 0n,
      feeBps: 0,
      symbol: m.symbol,
      name: m.name,
      logo: m.logo,
      walletBalance: 0n,
    };
  });
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeout = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/** Pick the largest single coin object that covers `amount`, else the largest. */
function selectFundingCoin(coins: SuiCoinObject[], amount: bigint): SuiCoinObject | null {
  if (coins.length === 0) return null;
  const sorted = [...coins].sort((a, b) =>
    BigInt(b.balance) > BigInt(a.balance) ? 1 : BigInt(b.balance) < BigInt(a.balance) ? -1 : 0,
  );
  return sorted.find((c) => BigInt(c.balance) >= amount) ?? sorted[0];
}

export function useSuiShield(walletAddress: string | null) {
  const { networkId } = useChainEnvironment();
  const suiNetwork = networkForChain(networkId, "sui");

  const [tokens, setTokens] = useState<SuiShieldToken[]>([]);
  const [loadingTokens, setLoadingTokens] = useState(false);
  const [status, setStatus] = useState<SuiShieldStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [txDigest, setTxDigest] = useState<string | null>(null);

  const loadTokens = useCallback(async () => {
    setLoadingTokens(true);
    setError(null);
    try {
      const cfg = getNetworkConfig(suiNetwork, { applyEnvOverrides: false });
      const registryId = cfg.sui?.tokenRegistry?.objectId;
      if (!registryId) {
        setTokens(fallbackTokensFromConfig(cfg));
        return;
      }
      const client = getSuiClient(suiNetwork);
      const registered = await withTimeout(
        fetchSuiEnabledTokens(client, registryId),
        TOKEN_REGISTRY_TIMEOUT_MS,
        "Sui token registry",
      );
      if (registered.length === 0) {
        setTokens(fallbackTokensFromConfig(cfg));
        return;
      }
      const meta = cfg.sui?.coinMetadata ?? {};

      const enriched = await Promise.all(
        registered.map(async (token): Promise<SuiShieldToken> => {
          let walletBalance = 0n;
          if (walletAddress) {
            try {
              const { totalBalance } = await client.getBalance({
                owner: walletAddress,
                coinType: token.coinType,
              });
              walletBalance = BigInt(totalBalance);
            } catch {
              walletBalance = 0n;
            }
          }
          const m = meta[token.coinType];
          return {
            ...token,
            symbol: m?.symbol ?? coinTypeTail(token.coinType),
            name: m?.name ?? coinTypeTail(token.coinType),
            logo: m?.logo,
            walletBalance,
          };
        }),
      );
      setTokens(enriched);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load Sui tokens");
      setTokens((current) => (current.length > 0 ? current : fallbackTokensFromConfig(getNetworkConfig(suiNetwork, { applyEnvOverrides: false }))));
    } finally {
      setLoadingTokens(false);
    }
  }, [suiNetwork, walletAddress]);

  useEffect(() => {
    void loadTokens();
  }, [loadTokens]);

  const shield = useCallback(
    async (token: SuiShieldToken, amount: bigint) => {
      setStatus("processing");
      setError(null);
      setTxDigest(null);
      try {
        if (!walletAddress) throw new Error("Connect a Sui wallet to shield funds");
        const wallet = getBrowserSuiWallet();
        if (!wallet) throw new Error("No Sui wallet was found for signing");

        const client = getSuiClient(suiNetwork);
        const { data } = await client.getCoins({ owner: walletAddress, coinType: token.coinType });
        const coins: SuiCoinObject[] = data.map((c) => ({
          coinObjectId: c.coinObjectId,
          version: c.version,
          digest: c.digest,
          balance: c.balance,
        }));
        const funding = selectFundingCoin(coins, amount);
        if (!funding) throw new Error(`No ${token.symbol} coins in the connected wallet`);
        if (BigInt(funding.balance) < amount) {
          throw new Error(`Insufficient ${token.symbol}: largest coin holds ${funding.balance}, need ${amount}`);
        }

        const utxopia = UTXOpiaClient.isInitialized ? UTXOpiaClient.instance() : await UTXOpiaClient.init();
        const output = await utxopia.prepareShieldOutput({ amount, mintAddress: token.coinType });

        const adapter = getSuiAdapter(suiNetwork);
        const unsigned = await adapter.buildShieldTokenTransaction({
          coinType: token.coinType,
          fundingCoin: { objectId: funding.coinObjectId, version: funding.version, digest: funding.digest },
          amount,
          npk: output.npkBytes,
          ephemeralPub: output.ephemeralPub,
        });

        // The PTB is built onlyTransactionKind; the wallet supplies sender + gas.
        const tx = Transaction.fromKind(unsigned.bytes);
        const digest = await signAndExecuteSuiTransaction(wallet, tx);

        setTxDigest(digest);
        setStatus("done");
        void loadTokens();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Shield failed");
        setStatus("error");
      }
    },
    [walletAddress, suiNetwork, loadTokens],
  );

  const reset = useCallback(() => {
    setStatus("idle");
    setError(null);
    setTxDigest(null);
  }, []);

  return { tokens, loadingTokens, status, error, txDigest, shield, reset, refreshTokens: loadTokens };
}
