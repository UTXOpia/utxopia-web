/**
 * Regtest BTC faucet.
 *
 * Talks to the `utxopia-esplora-regtest` container via `docker exec`, calling
 * bitcoin-cli the same way `scripts/hybrid/send-to.ts` does. It supports:
 *   - `utxo:...` private vault deposits, paid to the client-derived deposit
 *     address as a plain payment — no data output of any kind.
 *
 * Guard rails:
 *   - regtest-only: refuses unless the active network config uses regtest BTC
 *   - optional `X-API-Key` check (set REGTEST_FAUCET_API_KEY to enable)
 *   - daily quota (default 3 successful sends/day per recipient and IP)
 *   - amount capped at 0.001 BTC (100_000 sats) by default
 *   - auto-bootstraps spendable balance: if the regtest wallet has zero
 *     spendable BTC, runs `generatetoaddress 101 <miner>` once before the
 *     first deposit so users don't have to manually mine after `docker compose up`
 *   - returns 429 (with `retryAfterSec`) when in cooldown
 *
 * Override knobs (env):
 *   REGTEST_FAUCET_DOCKER_CONTAINER  default "utxopia-esplora-regtest"
 *   REGTEST_FAUCET_BITCOIN_CLI       default "/srv/explorer/bitcoin/bin/bitcoin-cli"
 *   REGTEST_FAUCET_BCLI_ARGS         default "-regtest -datadir=/data/bitcoin -rpcwallet=test"
 *   REGTEST_FAUCET_DAILY_LIMIT       default "3"
 *   REGTEST_FAUCET_MAX_SATS          default "100000"
 *   REGTEST_FAUCET_DEFAULT_SATS      default "100000"
 *   REGTEST_FAUCET_CONFIRMATIONS     default "6" (blocks mined right after the send)
 *   REGTEST_FAUCET_API_KEY           optional shared secret; required in X-API-Key header when set
 *   REGTEST_FAUCET_AUTOMINE          default "1" — set to "0" to disable initial-fund bootstrap
 */

import { NextRequest, NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import networks from "@/lib/networks.json";
import {
  detectNetworkFromRequest,
  getNetworkConfig,
  type NetworkConfig,
  type NetworkId,
} from "@/lib/network-config";
import { CHAIN_ADAPTERS } from "@/lib/chain-registry";
import { faucetBackendUrl } from "@/lib/server/faucet-backend";
import { applyBackendAuthHeaders } from "@/lib/server/backend-auth";
import { getClientIp } from "@/lib/server/rate-limit";
import { getVaultNetworkConfig, parseVaultId, vaultsSupported } from "@/lib/vault-config";
import {
  deriveDepositAddress,
  depositTweakCommitment,
} from "@utxopia/sdk";

const exec = promisify(execFile);

/**
 * The faucet's one funding address, when pinned.
 *
 * A BTC deposit into the permissioned pool has no Solana signer, so the only
 * identity the backend can gate on is the sending address — and it admits a
 * deposit only when that address is a registered exit
 * (BTC_REQUIRE_REGISTERED_EXIT). A wallet that rotates addresses can never
 * satisfy that. Pinning one address, mining to it and returning change to it
 * makes every faucet-funded deposit come from a destination the depositor can
 * also ragequit back to. Unset keeps the old rotating behaviour.
 */
const FIXED_ADDRESS = process.env.REGTEST_FAUCET_ADDRESS?.trim() || "";

const CONTAINER = process.env.REGTEST_FAUCET_DOCKER_CONTAINER || "utxopia-esplora-regtest";
const DOCKER_BIN_CANDIDATES = [
  process.env.REGTEST_FAUCET_DOCKER_BIN,
  process.env.DOCKER_BIN,
  "docker",
  "/usr/local/bin/docker",
  "/opt/homebrew/bin/docker",
].filter((candidate): candidate is string => Boolean(candidate));
const BCLI = process.env.REGTEST_FAUCET_BITCOIN_CLI || "/srv/explorer/bitcoin/bin/bitcoin-cli";
const BCLI_ARGS = (
  process.env.REGTEST_FAUCET_BCLI_ARGS || "-regtest -datadir=/data/bitcoin -rpcwallet=test"
).split(/\s+/).filter(Boolean);
const DAILY_LIMIT = Math.max(1, Number(process.env.REGTEST_FAUCET_DAILY_LIMIT || "3"));
const MAX_SATS = Math.max(1, Number(process.env.REGTEST_FAUCET_MAX_SATS || "100000"));
const DEFAULT_SATS = Math.min(
  MAX_SATS,
  Math.max(1, Number(process.env.REGTEST_FAUCET_DEFAULT_SATS || "100000")),
);
const CONFIRMATIONS = Math.max(1, Number(process.env.REGTEST_FAUCET_CONFIRMATIONS || "6"));
const API_KEY = process.env.REGTEST_FAUCET_API_KEY;
const REMOTE_FAUCET_MODE = process.env.REGTEST_FAUCET_MODE || (process.env.VERCEL ? "backend" : "local");
const AUTOMINE = process.env.REGTEST_FAUCET_AUTOMINE !== "0";
// Coinbase outputs need 100 confirmations before they're spendable, so mine
// 101 blocks on bootstrap (first block creates the coinbase reward, the next
// 100 make it spendable).
const BOOTSTRAP_BLOCKS = 101;

// File-backed daily quota. Survives Next.js process restarts so
// a hot-reload or redeploy doesn't reset everyone's allowance to zero. The
// map is loaded lazily on first access and written back after each deposit.
//
// Path defaults to `.faucet-limits.json` in the web project root; override
// via REGTEST_FAUCET_LIMIT_PATH if the deployment has a writable mount.
const LIMIT_PATH = process.env.REGTEST_FAUCET_LIMIT_PATH
  || process.env.REGTEST_FAUCET_COOLDOWN_PATH
  || path.join(process.cwd(), ".faucet-limits.json");

interface LimitEntry {
  day: string;
  count: number;
  lastAt: number;
}

interface LimitStore {
  /** recipient/IP key → daily quota entry */
  entries: Map<string, LimitEntry>;
}

function todayKey(): string {
  const now = new Date();
  return [
    now.getFullYear(),
    String(now.getMonth() + 1).padStart(2, "0"),
    String(now.getDate()).padStart(2, "0"),
  ].join("-");
}

function nextLocalDayStartMs(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime();
}

function loadLimitStore(): LimitStore {
  try {
    const raw = fs.readFileSync(LIMIT_PATH, "utf8");
    const obj = JSON.parse(raw) as Record<string, LimitEntry | number>;
    const day = todayKey();
    const entries = new Map<string, LimitEntry>();
    for (const [key, value] of Object.entries(obj)) {
      if (typeof value === "number") {
        entries.set(key, { day, count: 1, lastAt: value });
      } else if (value && typeof value.count === "number") {
        entries.set(key, value);
      }
    }
    return { entries };
  } catch {
    return { entries: new Map() };
  }
}

function saveLimitStore(store: LimitStore): void {
  const day = todayKey();
  const live: Record<string, LimitEntry> = {};
  for (const [key, entry] of store.entries) {
    if (entry.day === day) live[key] = entry;
  }
  try {
    fs.writeFileSync(LIMIT_PATH, JSON.stringify(live) + "\n", { mode: 0o600 });
  } catch (e) {
    // Disk failure → fall through; the in-memory map still works for this
    // process. Worst case: a restart resets the cooldown for affected
    // addresses.
    console.warn("[Faucet] Failed to persist limit store:", e);
  }
}

const limitStore: LimitStore = (() => {
  const g = globalThis as unknown as { __utxopiaFaucetLimit?: LimitStore };
  if (!g.__utxopiaFaucetLimit) g.__utxopiaFaucetLimit = loadLimitStore();
  return g.__utxopiaFaucetLimit;
})();

// Once we've confirmed the wallet has spendable balance (either it always
// did, or we just bootstrapped it), skip the balance check on future deposits.
// Held on globalThis so Next.js hot-reload doesn't clear it.
const bootstrapState: { confirmed: boolean } = (() => {
  const g = globalThis as unknown as { __utxopiaFaucetBootstrap?: { confirmed: boolean } };
  if (!g.__utxopiaFaucetBootstrap) g.__utxopiaFaucetBootstrap = { confirmed: false };
  return g.__utxopiaFaucetBootstrap;
})();

interface DepositBody {
  stealthAddress?: string;
  amountSats?: number;
  /** Client-derived deposit address, with the keys it was derived from.
   *  See `tweakDepositFromBody` for why the client derives it. */
  depositAddress?: string;
  notePublicKey?: string;
  ephemeralPubkey?: string;
}

interface FaucetNetworkConfig {
  bitcoin?: {
    network?: string;
  };
  ika?: {
    dwalletXOnlyPubkey?: string;
  };
}

async function callBackendFaucet(
  network: NetworkId,
  payload: {
    address: string;
    amountSats: number;
    recipientKey?: string;
    depositScheme?: "tweak";
  },
  config?: NetworkConfig | null,
  /** Merged into a successful reply. The tracker id is known only to this route. */
  extra: Record<string, unknown> = {},
): Promise<{ response: NextResponse; succeeded: boolean } | null> {
  const backendUrl = faucetBackendUrl(network, config);
  const headers = applyBackendAuthHeaders({ "Content-Type": "application/json" });

  let res: Response;
  try {
    res = await fetch(`${backendUrl}/api/faucet/regtest`, {
      method: "POST",
      headers,
      body: JSON.stringify(payload),
      cache: "no-store",
    });
  } catch (e) {
    if (REMOTE_FAUCET_MODE === "backend") {
      return {
        succeeded: false,
        response: NextResponse.json(
          {
            ok: false,
            error: `backend faucet unreachable: ${e instanceof Error ? e.message : String(e)}`,
          },
          { status: 502 },
        ),
      };
    }
    return null;
  }

  const text = await res.text();
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    const ray = res.headers.get("cf-ray");
    body = {
      ok: false,
      error:
        `BTC faucet backend is temporarily unavailable (HTTP ${res.status}). ` +
        "The request was not retried to avoid sending BTC twice. Check Activity before trying again." +
        (ray ? ` Reference: ${ray}.` : ""),
    };
  }

  const succeeded =
    res.ok && typeof body === "object" && body !== null && (body as { ok?: boolean }).ok === true;

  // The backend reports a limit hit as a plain error string. Callers key their
  // cooldown UI off `retryAfterSec`, so without this a backend 429 renders as a
  // dead-end error with no countdown and a still-enabled button.
  if (res.status === 429 && typeof body === "object" && body !== null) {
    const withQuota = body as Record<string, unknown>;
    if (typeof withQuota.retryAfterSec !== "number") {
      const header = Number(res.headers.get("retry-after"));
      withQuota.retryAfterSec = Number.isFinite(header) && header > 0
        ? header
        : Math.max(1, Math.ceil((nextLocalDayStartMs() - Date.now()) / 1000));
      withQuota.dailyLimit ??= DAILY_LIMIT;
      withQuota.remaining ??= 0;
    }
  }

  if (succeeded) body = { ...(body as Record<string, unknown>), ...extra };
  return { succeeded, response: NextResponse.json(body, { status: res.status }) };
}

async function runBitcoinCli(args: string[]): Promise<string> {
  const fullArgs = ["exec", CONTAINER, BCLI, ...BCLI_ARGS, ...args];
  let dockerNotFound: Error | null = null;
  for (const dockerBin of DOCKER_BIN_CANDIDATES) {
    try {
      const { stdout } = await exec(dockerBin, fullArgs, { maxBuffer: 1024 * 1024 });
      return stdout.trim();
    } catch (e) {
      if (isEnoent(e)) {
        dockerNotFound = e;
        continue;
      }
      throw e;
    }
  }
  const tried = DOCKER_BIN_CANDIDATES.join(", ");
  throw new Error(
    `docker CLI not found (tried: ${tried}). Set REGTEST_FAUCET_DOCKER_BIN to the absolute docker path.`,
    { cause: dockerNotFound ?? undefined },
  );
}

function isEnoent(e: unknown): e is NodeJS.ErrnoException {
  return e instanceof Error && "code" in e && (e as NodeJS.ErrnoException).code === "ENOENT";
}

function satsToBtcDecimal(sats: number): string {
  // bitcoin-cli expects BTC, not sats. Print with 8 decimals to avoid
  // scientific notation tripping up the RPC parser for small amounts.
  const btc = sats / 1e8;
  return btc.toFixed(8);
}

function hex(buf: Uint8Array): string {
  return Buffer.from(buf).toString("hex");
}

function hexToBytes(value: string): Uint8Array {
  const normalized = value.trim().replace(/^0x/, "");
  if (!/^[0-9a-fA-F]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new Error("invalid hex string");
  }
  return Uint8Array.from(Buffer.from(normalized, "hex"));
}

function getFallbackNetworkConfig(): FaucetNetworkConfig {
  const network = process.env.NEXT_PUBLIC_NETWORK || process.env.UTXOPIA_NETWORK || CHAIN_ADAPTERS.solana.hybridNetwork || CHAIN_ADAPTERS.solana.defaultNetwork;
  const configs = networks as Record<string, FaucetNetworkConfig>;
  return configs[network] ?? configs[CHAIN_ADAPTERS.solana.hybridNetwork ?? CHAIN_ADAPTERS.solana.defaultNetwork];
}

function getRequestNetwork(req: NextRequest): NetworkId {
  try {
    return detectNetworkFromRequest(req);
  } catch {
    const env = process.env.NEXT_PUBLIC_NETWORK || process.env.UTXOPIA_NETWORK;
    return env && Object.values(CHAIN_ADAPTERS).some((adapter) => adapter.networkIds.includes(env as NetworkId))
      ? env as NetworkId
      : CHAIN_ADAPTERS.solana.hybridNetwork ?? CHAIN_ADAPTERS.solana.defaultNetwork;
  }
}

function getRequestNetworkConfig(network: NetworkId): NetworkConfig | FaucetNetworkConfig {
  try {
    return getNetworkConfig(network, { applyEnvOverrides: false });
  } catch {
    return getFallbackNetworkConfig();
  }
}

function getDeploymentBitcoinNetwork(): string | undefined {
  const explicit = process.env.UTXOPIA_BITCOIN_NETWORK || process.env.NEXT_PUBLIC_BTC_NETWORK;
  if (explicit) return explicit;

  const deploymentNetwork = process.env.UTXOPIA_NETWORK || process.env.NEXT_PUBLIC_NETWORK;
  if (!deploymentNetwork) return undefined;
  try {
    return getNetworkConfig(deploymentNetwork as NetworkId, { applyEnvOverrides: false }).bitcoin.network;
  } catch {
    return undefined;
  }
}

type FaucetDeposit = {
  btcAddress: string;
  npk: Uint8Array;
  ephemeralPub: Uint8Array;
};

/**
 * Validate a client-derived tweak deposit address.
 *
 * This route CANNOT derive one itself. A recoverable deposit address indexes its
 * ephemeral key off the recipient's viewing *private* key, and a stealth
 * meta-address carries only `viewingPubKey`. Deriving one here would mean a random
 * ephemeral key — and since the address commits to it through the tapleaf while
 * the key path is a NUMS point, losing that key burns the coins outright. So the
 * client derives (`UTXOpiaClient.prepareTweakDeposit`) and this route checks.
 *
 * The check needs no secret: recompute the address from the supplied public keys
 * and refuse if it differs. That catches a broken client before coins move rather
 * than after.
 */
function tweakDepositFromBody(
  body: DepositBody,
  cfg: NetworkConfig | FaucetNetworkConfig,
): { deposit: FaucetDeposit } | { error: string } {
  const { depositAddress, notePublicKey, ephemeralPubkey } = body;
  if (!depositAddress || !notePublicKey || !ephemeralPubkey) {
    return {
      error:
        "tweak deposits need depositAddress, notePublicKey and ephemeralPubkey — " +
        "derive them client-side with prepareTweakDeposit",
    };
  }

  const vaultKeyHex = cfg?.ika?.dwalletXOnlyPubkey;
  if (!vaultKeyHex || /^0+$/.test(vaultKeyHex)) {
    return { error: "network has no Ika dWallet key configured" };
  }

  let npk: Uint8Array;
  let eph: Uint8Array;
  try {
    npk = hexToBytes(notePublicKey);
    eph = hexToBytes(ephemeralPubkey);
  } catch {
    return { error: "notePublicKey and ephemeralPubkey must be hex" };
  }
  if (npk.length !== 32 || eph.length !== 32) {
    return { error: "notePublicKey and ephemeralPubkey must be 32 bytes" };
  }

  const network = cfg?.bitcoin?.network === "regtest" ? "regtest" : "testnet";
  let derived: string;
  try {
    derived = deriveDepositAddress(
      depositTweakCommitment(npk, eph),
      hexToBytes(vaultKeyHex),
      network,
    ).address;
  } catch (e) {
    return {
      error: `could not derive deposit address: ${truncate(e instanceof Error ? e.message : String(e), 200)}`,
    };
  }

  if (derived !== depositAddress) {
    return { error: `depositAddress does not match its keys: those keys derive ${derived}` };
  }

  return {
    deposit: { btcAddress: depositAddress, npk, ephemeralPub: eph },
  };
}

/**
 * Register a tweak deposit with the tracker BEFORE any coins move.
 *
 * A deposit with no OP_RETURN is invisible to block scanning — the tracker's only
 * way to find it is polling the addresses it was told about. Send first and a
 * failed registration leaves coins at an address nobody is watching, with no
 * refund path yet to get them back.
 */
async function registerTweakDeposit(
  network: NetworkId,
  deposit: FaucetDeposit,
  amountSats: number,
  cfg: NetworkConfig | FaucetNetworkConfig,
): Promise<{ error: string } | { depositId: string }> {
  const backendUrl = faucetBackendUrl(network, cfg as NetworkConfig);
  try {
    const res = await fetch(`${backendUrl}/api/deposits`, {
      method: "POST",
      headers: applyBackendAuthHeaders({ "Content-Type": "application/json" }),
      cache: "no-store",
      body: JSON.stringify({
        taproot_address: deposit.btcAddress,
        note_public_key: hex(deposit.npk),
        ephemeral_pubkey: hex(deposit.ephemeralPub),
        amount_sats: amountSats,
        deposit_scheme: "tweak",
      }),
    });
    if (!res.ok) return { error: `tracker rejected the registration (HTTP ${res.status})` };
    const body = (await res.json()) as { deposit_id?: string };
    return body.deposit_id ? { depositId: body.deposit_id } : { error: "tracker accepted the registration without an id" };
  } catch (e) {
    return { error: `tracker unreachable: ${truncate(e instanceof Error ? e.message : String(e), 200)}` };
  }
}

function limitKey(kind: "recipient" | "ip", value: string): string {
  return `${kind}:${value.toLowerCase()}`;
}

function getLimitStatus(keys: string[]): { ok: true } | { ok: false; remaining: number } {
  const day = todayKey();
  for (const key of keys) {
    const entry = limitStore.entries.get(key);
    if (entry?.day === day && entry.count >= DAILY_LIMIT) {
      return { ok: false, remaining: Math.max(1, Math.ceil((nextLocalDayStartMs() - Date.now()) / 1000)) };
    }
  }
  return { ok: true };
}

/**
 * Stable per-recipient quota key for the backend limiter.
 *
 * The backend can't identify the depositor from the deposit: every deposit has
 * its own address, so quotaing on that gives every request its own bucket.
 * Hashing the private address gives it something that repeats without handing
 * it the address itself.
 */
function recipientQuotaKey(stealthAddress: string): string {
  return createHash("sha256").update(stealthAddress.toLowerCase()).digest("hex");
}

interface QuotaView {
  dailyLimit: number;
  used: number;
  remaining: number;
  /** Seconds until the allowance resets. 0 when untouched. */
  resetAfterSec: number;
}

/** Quota per this route's own file-backed counter. */
function localQuota(keys: string[]): QuotaView {
  const day = todayKey();
  let used = 0;
  for (const key of keys) {
    const entry = limitStore.entries.get(key);
    if (entry?.day === day) used = Math.max(used, entry.count);
  }
  return {
    dailyLimit: DAILY_LIMIT,
    used: Math.min(used, DAILY_LIMIT),
    remaining: Math.max(0, DAILY_LIMIT - used),
    resetAfterSec: used > 0 ? Math.max(1, Math.ceil((nextLocalDayStartMs() - Date.now()) / 1000)) : 0,
  };
}

/** Quota per the backend's limiter, or null if it can't answer. */
async function backendQuota(
  network: NetworkId,
  params: { address: string; recipientKey: string },
  config?: NetworkConfig | null,
): Promise<QuotaView | null> {
  const backendUrl = faucetBackendUrl(network, config);
  const query = new URLSearchParams({
    address: params.address,
    recipientKey: params.recipientKey,
  });
  try {
    const res = await fetch(`${backendUrl}/api/faucet/regtest/quota?${query.toString()}`, {
      headers: applyBackendAuthHeaders({}),
      cache: "no-store",
    });
    if (!res.ok) return null;
    const body = (await res.json()) as Partial<Record<keyof QuotaView, number>>;
    if (typeof body.remaining !== "number") return null;
    return {
      dailyLimit: body.dailyLimit ?? DAILY_LIMIT,
      used: body.used ?? 0,
      remaining: body.remaining,
      resetAfterSec: body.resetAfterSec ?? 0,
    };
  } catch {
    return null;
  }
}

/** Whichever limiter rejects first is the one the user will actually hit. */
function tighterQuota(a: QuotaView, b: QuotaView | null): QuotaView {
  return b && b.remaining < a.remaining ? b : a;
}

function recordLimitHit(keys: string[]): void {
  const day = todayKey();
  const now = Date.now();
  for (const key of keys) {
    const entry = limitStore.entries.get(key);
    if (entry?.day === day) {
      entry.count += 1;
      entry.lastAt = now;
    } else {
      limitStore.entries.set(key, { day, count: 1, lastAt: now });
    }
  }
  saveLimitStore(limitStore);
}

interface PinnedUtxo {
  txid: string;
  vout: number;
  amount: number;
}

/** Spendable UTXOs sitting on the pinned funding address. `listunspent` omits
 *  immature coinbase, so what comes back is genuinely spendable. */
async function pinnedUtxos(): Promise<PinnedUtxo[]> {
  const json = await runBitcoinCli([
    "listunspent",
    "1",
    "9999999",
    JSON.stringify([FIXED_ADDRESS]),
  ]);
  return JSON.parse(json) as PinnedUtxo[];
}

/**
 * Inputs for a send of `amountBtc`, drawn only from the pinned address.
 *
 * Explicit selection rather than the wallet's own coin selection: this wallet
 * holds hundreds of UTXOs across a hundred addresses from before the address
 * was pinned, and letting it choose would spend those instead — producing a
 * deposit whose sending address the pool has no exit registered for, which the
 * backend then holds. Largest-first so the common case is a single input.
 */
async function pinnedInputs(amountBtc: number): Promise<string> {
  const utxos = (await pinnedUtxos()).sort((a, b) => b.amount - a.amount);
  const target = amountBtc + 0.01; // fee headroom; regtest fees are negligible
  const chosen: PinnedUtxo[] = [];
  let total = 0;
  for (const utxo of utxos) {
    if (total >= target) break;
    chosen.push(utxo);
    total += utxo.amount;
  }
  if (total < target) {
    throw new Error(
      `pinned address ${FIXED_ADDRESS} holds ${total} BTC, needs ${target}. ` +
        "Mine to it, or unset REGTEST_FAUCET_ADDRESS to use the whole wallet.",
    );
  }
  return JSON.stringify(chosen.map(({ txid, vout }) => ({ txid, vout })));
}

/**
 * Ensure the regtest wallet has spendable balance. If `getbalance` returns 0
 * and AUTOMINE is enabled, mine `BOOTSTRAP_BLOCKS` to a fresh address so the
 * coinbase reward is spendable. Idempotent — flips `bootstrapState.confirmed`
 * on first success so subsequent deposits skip the RPC roundtrip.
 *
 * Returns `null` on success; an error string on failure (caller decides
 * whether to surface or proceed).
 */
async function ensureWalletFunded(): Promise<string | null> {
  if (bootstrapState.confirmed) return null;
  let balanceStr: string;
  try {
    // With a pinned address the wallet's total is the wrong question: the
    // faucet spends only that address's UTXOs, so a wallet holding thousands
    // of BTC on other addresses is still unable to fund a single deposit.
    balanceStr = FIXED_ADDRESS
      ? String((await pinnedUtxos()).reduce((sum, u) => sum + u.amount, 0))
      : await runBitcoinCli(["getbalance"]);
  } catch (e) {
    return `getbalance failed: ${e instanceof Error ? e.message : String(e)}`;
  }
  // bitcoin-cli emits balance as a decimal BTC string, e.g. "0.00000000".
  const balanceBtc = Number(balanceStr);
  if (Number.isFinite(balanceBtc) && balanceBtc > 0) {
    bootstrapState.confirmed = true;
    return null;
  }
  if (!AUTOMINE) {
    return (
      `wallet has zero spendable balance; bootstrap disabled (REGTEST_FAUCET_AUTOMINE=0). ` +
      `Run \`docker exec ${CONTAINER} ${BCLI} ${BCLI_ARGS.join(" ")} generatetoaddress ${BOOTSTRAP_BLOCKS} <addr>\` manually.`
    );
  }
  try {
    const miner = FIXED_ADDRESS || (await runBitcoinCli(["getnewaddress"]));
    console.log(`[Faucet] Bootstrapping: mining ${BOOTSTRAP_BLOCKS} blocks to ${miner}`);
    await runBitcoinCli(["generatetoaddress", String(BOOTSTRAP_BLOCKS), miner]);
    bootstrapState.confirmed = true;
    return null;
  } catch (e) {
    return `bootstrap mining failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/**
 * The pinned funding address, or null when the faucet still rotates.
 *
 * Served rather than duplicated into a NEXT_PUBLIC_ variable so there is one
 * source of truth: the address the faucet actually spends from is the only one
 * worth registering as an exit, and a second copy could drift from it.
 */
/**
 * Also reports the caller's remaining daily allowance, so the UI can say how
 * many drips are left instead of finding out by spending one and getting a 429.
 *
 * `stealthAddress` is optional — without it the answer covers the IP quota only,
 * which is what the callers that just want `address` already get.
 */
export async function GET(req: NextRequest): Promise<NextResponse> {
  const url = new URL(req.url);
  const stealthAddress = (url.searchParams.get("stealthAddress") ?? "").trim();
  const hasRecipient = /^utxo:[0-9a-fA-F]{192}$/.test(stealthAddress);

  const quotaKeys = [limitKey("ip", getClientIp(req.headers))];
  if (hasRecipient) quotaKeys.unshift(limitKey("recipient", stealthAddress));
  let quota = localQuota(quotaKeys);

  // In backend mode the deposit is sent by the backend, so its limiter is the
  // one that will reject — ask it too and report whichever binds first.
  if (REMOTE_FAUCET_MODE === "backend" && hasRecipient) {
    try {
      const network = getRequestNetwork(req);
      let config = getRequestNetworkConfig(network);
      const vaultId = parseVaultId(url.searchParams.get("vault"));
      if (vaultsSupported(network) && "solana" in config) {
        config = getVaultNetworkConfig(network, config as NetworkConfig, vaultId);
      }
      // The probe only needs a bucket key, and `recipientKey` is what the limiter
      // actually binds to. There is no deposit address to send: deriving one
      // would need the recipient's viewing key, which never leaves the client.
      quota = tighterQuota(
        quota,
        await backendQuota(
          network,
          {
            address: "",
            recipientKey: recipientQuotaKey(stealthAddress),
          },
          config as NetworkConfig,
        ),
      );
    } catch {
      // Backend unreachable or address unusable — the local view still stands.
    }
  }

  return NextResponse.json({ address: FIXED_ADDRESS || null, ...quota });
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  const deploymentBtcNetwork = getDeploymentBitcoinNetwork();
  if (deploymentBtcNetwork && deploymentBtcNetwork !== "regtest") {
    return NextResponse.json(
      { ok: false, error: "regtest faucet is not deployed on this Bitcoin network" },
      { status: 404 },
    );
  }

  const activeNetwork = getRequestNetwork(req);
  let activeConfig = getRequestNetworkConfig(activeNetwork);
  // Vault-scope the deposit: the address is tweaked against the destination
  // pool's Ika key (Open vs Verified are distinct pools with distinct keys).
  // Open needs the overlay too — the base network config can point at an older
  // deployment, and a key no tracker watches strands the deposit silently.
  const vaultId = parseVaultId(new URL(req.url).searchParams.get("vault"));
  if (vaultsSupported(activeNetwork) && "solana" in activeConfig) {
    activeConfig = getVaultNetworkConfig(activeNetwork, activeConfig as NetworkConfig, vaultId);
  }
  const btcNetwork = activeConfig?.bitcoin?.network || process.env.NEXT_PUBLIC_BTC_NETWORK || "";

  if (btcNetwork !== "regtest") {
    return NextResponse.json(
      {
        ok: false,
        error: `faucet only available on regtest; current network=${activeNetwork}, btcNetwork=${btcNetwork || "unknown"}`,
      },
      { status: 400 },
    );
  }

  // Optional auth: only enforced when REGTEST_FAUCET_API_KEY is set.
  if (API_KEY) {
    const provided = req.headers.get("x-api-key") || req.headers.get("X-API-Key");
    if (provided !== API_KEY) {
      return NextResponse.json(
        { ok: false, error: "missing or invalid X-API-Key" },
        { status: 401 },
      );
    }
  }

  let body: DepositBody;
  try {
    body = (await req.json()) as DepositBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid JSON body" }, { status: 400 });
  }

  const stealthAddress = (body.stealthAddress ?? "").trim();
  const amountSats = Number(body.amountSats ?? DEFAULT_SATS);
  if (!/^utxo:[0-9a-fA-F]{192}$/.test(stealthAddress)) {
    return NextResponse.json(
      { ok: false, error: "stealthAddress must be a UTXOpia private address" },
      { status: 400 },
    );
  }
  if (!Number.isInteger(amountSats) || amountSats <= 0 || amountSats > MAX_SATS) {
    return NextResponse.json(
      { ok: false, error: `amountSats must be an integer from 1..${MAX_SATS}` },
      { status: 400 },
    );
  }

  const clientIp = getClientIp(req.headers);
  const quotaKeys = [
    limitKey("recipient", stealthAddress),
    limitKey("ip", clientIp),
  ];
  const quota = getLimitStatus(quotaKeys);
  if (!quota.ok) {
    return NextResponse.json(
      {
        ok: false,
        error: `daily deposit limit reached: max ${DAILY_LIMIT} request${DAILY_LIMIT === 1 ? "" : "s"} per day`,
        retryAfterSec: quota.remaining,
        dailyLimit: DAILY_LIMIT,
        used: DAILY_LIMIT,
        remaining: 0,
      },
      { status: 429, headers: { "Retry-After": String(quota.remaining) } },
    );
  }

  const derived = tweakDepositFromBody(body, activeConfig);
  if ("error" in derived) {
    return NextResponse.json({ ok: false, error: derived.error }, { status: 400 });
  }
  const tweakDeposit: FaucetDeposit = derived.deposit;
  const btcAddress = tweakDeposit.btcAddress;
  let depositVout: number | undefined;

  // Register before sending, never after. Nothing on chain identifies a tweak
  // deposit, so an address the tracker was never told about is one nobody is
  // watching.
  const registration = await registerTweakDeposit(
    activeNetwork,
    tweakDeposit,
    amountSats,
    activeConfig,
  );
  if ("error" in registration) {
    return NextResponse.json(
      { ok: false, error: `not sending: ${registration.error}` },
      { status: 502 },
    );
  }
  const depositId = registration.depositId;

  if (REMOTE_FAUCET_MODE === "backend") {
    const remote = await callBackendFaucet(
      activeNetwork,
      {
        address: btcAddress,
        amountSats,
        recipientKey: recipientQuotaKey(stealthAddress),
        depositScheme: "tweak",
      },
      activeConfig as NetworkConfig,
      { depositId, depositAddress: btcAddress },
    );
    if (remote) {
      // Record here too: this path returns before the local send, so without it
      // the counter checked above is never written and the cap never binds.
      if (remote.succeeded) recordLimitHit(quotaKeys);
      return remote.response;
    }
  }

  // 0. Bootstrap: on first call after `docker compose up`, mine 101 blocks
  // if the wallet has nothing spendable yet. No-ops on subsequent calls.
  const bootstrapErr = await ensureWalletFunded();
  if (bootstrapErr) {
    return NextResponse.json(
      {
        ok: false,
        error:
          `${bootstrapErr}. Check that the regtest container is running ` +
          `(docker compose -f docker-compose.regtest.yml up -d).`,
      },
      { status: 502 },
    );
  }

  // 1. Create and broadcast the deposit transaction. A tweak deposit is nothing
  // but a payment — exactly what an exchange withdrawal looks like — so it gets
  // no data output at all.
  let txid: string;
  try {
    const outputs = JSON.stringify([{ [btcAddress]: Number(satsToBtcDecimal(amountSats)) }]);
    const inputs = FIXED_ADDRESS
      ? await pinnedInputs(Number(satsToBtcDecimal(amountSats)))
      : "[]";
    const rawHex = await runBitcoinCli(["createrawtransaction", inputs, outputs]);
    // Change returns to the funding address and `add_inputs: false` forbids the
    // wallet from reaching for any other UTXO, so every input and every output
    // this faucet ever creates stays on the one address the pool knows.
    const fundedJson = await runBitcoinCli(
      FIXED_ADDRESS
        ? [
            "fundrawtransaction",
            rawHex,
            JSON.stringify({ changeAddress: FIXED_ADDRESS, add_inputs: false }),
          ]
        : ["fundrawtransaction", rawHex],
    );
    const fundedHex = JSON.parse(fundedJson).hex;
    const signedJson = await runBitcoinCli(["signrawtransactionwithwallet", fundedHex]);
    const signed = JSON.parse(signedJson);
    if (!signed.complete) throw new Error(`sign failed: ${JSON.stringify(signed.errors ?? [])}`);
    const decodedSignedJson = await runBitcoinCli(["decoderawtransaction", signed.hex]);
    const decodedSigned = JSON.parse(decodedSignedJson);
    const depositOutput = decodedSigned.vout?.find((out: { n?: number; value?: number; scriptPubKey?: { address?: string } }) =>
      out.scriptPubKey?.address === btcAddress &&
      Math.round(Number(out.value ?? 0) * 1e8) === amountSats
    );
    if (typeof depositOutput?.n === "number") depositVout = depositOutput.n;
    txid = await runBitcoinCli(["sendrawtransaction", signed.hex]);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      {
        ok: false,
        error: `deposit transaction failed: ${truncate(msg, 400)}. ` +
          "Check that the regtest container is running (docker compose -f docker-compose.regtest.yml up -d).",
      },
      { status: 502 },
    );
  }

  // 2. Mine N blocks so the tracker sees a confirmed deposit. Rewards go to the
  //    pinned address too, so the wallet refills without ever spending from an
  //    address the pool has not seen.
  let minerAddr = "";
  let blocksMined = 0;
  try {
    minerAddr = FIXED_ADDRESS || (await runBitcoinCli(["getnewaddress"]));
    await runBitcoinCli(["generatetoaddress", String(CONFIRMATIONS), minerAddr]);
    blocksMined = CONFIRMATIONS;
  } catch (e) {
    // Send succeeded but the mine failed — surface that explicitly so the
    // caller knows the tx is still in the mempool, just not confirmed. The
    // faucet quota is still consumed because the deposit was already broadcast.
    recordLimitHit(quotaKeys);
    return NextResponse.json(
      {
        ok: true,
        txid,
        warning: `deposit broadcast but failed to mine confirmation block: ${truncate(e instanceof Error ? e.message : String(e), 200)}`,
      },
      { status: 200 },
    );
  }

  // Record quota only on full success — if it failed before mining, the user
  // can retry without burning one of the daily attempts.
  recordLimitHit(quotaKeys);

  return NextResponse.json({
    ok: true,
    txid,
    mode: "vault_deposit",
    depositId,
    depositAddress: btcAddress,
    depositVout,
    depositScheme: "tweak",
    amountSats,
    dailyLimit: DAILY_LIMIT,
    remaining: localQuota(quotaKeys).remaining,
    blocksMined,
    minerAddress: minerAddr,
  });
}

function truncate(s: string, n: number): string {
  return s.length <= n ? s : s.slice(0, n) + "…";
}
