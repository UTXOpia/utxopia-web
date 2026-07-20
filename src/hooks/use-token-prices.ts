import useSWR from "swr";

const PRICES_API_URL = "/api/token-prices";

const CACHE_KEY = "token_prices_cache";
const STALE_MS = 60_000; // refresh every 60s
const FETCH_TIMEOUT_MS = 3_000;

export interface TokenPrices {
  btc: number | null;
  sol: number | null;
  sui: number | null;
  usdc: number | null;
  usdt: number | null;
}

const EMPTY: TokenPrices = { btc: null, sol: null, sui: null, usdc: null, usdt: null };

interface Cache {
  prices: TokenPrices;
  ts: number;
}

function readCache(): Cache | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const c: Cache = JSON.parse(raw);
    if (Date.now() - c.ts < STALE_MS) return c;
  } catch (err) { console.error("[TokenPrices] cache read error:", err); }
  return null;
}

function writeCache(prices: TokenPrices) {
  if (typeof window === "undefined") return;
  try {
    sessionStorage.setItem(CACHE_KEY, JSON.stringify({ prices, ts: Date.now() }));
  } catch (err) { console.error("[TokenPrices] cache write error:", err); }
}

async function fetchPricesFromApi(): Promise<TokenPrices | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(PRICES_API_URL, { signal: controller.signal });
    if (!res.ok) return null;
    const data = await res.json();
    return {
      btc: data?.btc ?? null,
      sol: data?.sol ?? null,
      sui: data?.sui ?? null,
      usdc: data?.usdc ?? null,
      usdt: data?.usdt ?? null,
    };
  } catch (err) {
    console.error("[TokenPrices] API fetch error:", err);
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function getTokenPrices(): Promise<TokenPrices> {
  const cached = readCache();
  if (cached) return cached.prices;
  return (await fetchPricesFromApi()) ?? EMPTY;
}

function hasPrice(prices: TokenPrices): boolean {
  return Object.values(prices).some((price) => price != null);
}

/** Fetch all token prices (BTC, SOL, USDC, USDT) via same-origin API */
export function useTokenPrices(): TokenPrices {
  const { data } = useSWR<TokenPrices>(PRICES_API_URL, getTokenPrices, {
    fallbackData: EMPTY,
    dedupingInterval: STALE_MS,
    refreshInterval: STALE_MS,
    revalidateOnFocus: false,
    refreshWhenHidden: false,
    refreshWhenOffline: false,
    onSuccess: (prices) => {
      if (hasPrice(prices)) writeCache(prices);
    },
  });

  return data ?? EMPTY;
}
