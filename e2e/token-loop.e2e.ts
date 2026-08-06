#!/usr/bin/env bun
/**
 * token-loop.e2e.ts — Browser E2E for the dev-signer "token loop"
 *
 * Drives: SHIELD → TRANSFER → UNSHIELD on Solana devnet.
 *
 * Requirements:
 *   - App running:  cd web && NEXT_PUBLIC_DEV_SIGNER=1 bun run dev
 *   - Dev keys:     set UTXOPIA_DEV_KEYS_JSON or populate e2e/.dev-keys.json
 *   - Funded:       run Task-8 funding step before this script
 *
 * Live run is user-gated (requires running app + funded testnet/devnet accounts).
 */

import { execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DevKeys {
  solanaSecretKeyB58: string;
  btcWif: string;
  utxopiaSeedHex: string;
}

interface ChainConfig {
  name: string;
  networkParam: string;
  /** URL query param value for ?network= */
  network: string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

/** BTC-leg feature flag — set RUN_BTC=1 to enable BTC deposit + redeem steps.
 *  Requires the full backend stack (see README § BTC legs). */
const RUN_BTC = process.env.RUN_BTC === "1";

/** BTC deposit amount in sats — the deposit field is denominated in sats
 *  ("Amount (sats)"), not BTC. 10_000 sats = 0.0001 BTC. */
const BTC_DEPOSIT_AMOUNT_SATS = process.env.E2E_BTC_DEPOSIT_AMOUNT_SATS ?? "10000";

/** BTC redeem amount in sats (what to cash out). */
const BTC_REDEEM_AMOUNT = process.env.E2E_BTC_REDEEM_AMOUNT ?? "5000";

/** BTC address to receive the redeem payout (testnet / regtest address). */
const BTC_REDEEM_ADDR = process.env.E2E_BTC_REDEEM_ADDR ?? "REPLACE_WITH_BTC_ADDRESS"; // VERIFY: must be a valid testnet/regtest bech32 address

/** How long to poll for the BTC deposit note to appear (ms). Default 10 min. */
const BTC_DEPOSIT_TIMEOUT_MS = parseInt(process.env.BTC_DEPOSIT_TIMEOUT_MS ?? "600000", 10);

/** How long to poll for the BTC redeem txid to appear (ms). Default 10 min. */
const BTC_REDEEM_TIMEOUT_MS = parseInt(process.env.BTC_REDEEM_TIMEOUT_MS ?? "600000", 10);

const CHAINS: ChainConfig[] = [
  { name: "Solana devnet", networkParam: "devnet", network: "devnet" },
];

/** Token symbol driven by the loop; must match a token-option-<symbol> testid. */
const SHIELD_TOKEN = process.env.E2E_SHIELD_TOKEN ?? "SOL";

/** Amount to shield / transfer / unshield per step.
 *  Must be well below the funded balance. Adjust per funded amount. */
const SHIELD_AMOUNT = "0.01";
const TRANSFER_AMOUNT = "0.005";
const UNSHIELD_AMOUNT = "0.004";

/** Dummy stealth recipient for the transfer step.
 *  Replace with a real utxo:… address derived from the dev seed before live run. */
const TRANSFER_RECIPIENT = process.env.E2E_TRANSFER_RECIPIENT ?? "REPLACE_WITH_STEALTH_ADDRESS"; // VERIFY: must be a valid utxo:… stealth meta address

/** Solana devnet: unshield destination (public wallet address). */
const SOL_UNSHIELD_ADDR = process.env.E2E_SOL_UNSHIELD_ADDR ?? "REPLACE_WITH_SOL_ADDRESS"; // VERIFY: a valid Solana devnet public key

// ---------------------------------------------------------------------------
// Key loading
// ---------------------------------------------------------------------------

function loadDevKeys(): DevKeys {
  const fromEnv = process.env.UTXOPIA_DEV_KEYS_JSON;
  if (fromEnv) {
    try {
      return JSON.parse(fromEnv) as DevKeys;
    } catch {
      throw new Error("UTXOPIA_DEV_KEYS_JSON is set but is not valid JSON");
    }
  }

  const keyFile = path.join(__dirname, ".dev-keys.json");
  if (fs.existsSync(keyFile)) {
    return JSON.parse(fs.readFileSync(keyFile, "utf-8")) as DevKeys;
  }

  throw new Error(
    "Dev keys not found. Either set UTXOPIA_DEV_KEYS_JSON or create e2e/.dev-keys.json. " +
      "See e2e/README.md for the required shape.",
  );
}

// ---------------------------------------------------------------------------
// agent-browser helpers
// ---------------------------------------------------------------------------

/** Run an agent-browser command and return stdout. Throws on non-zero exit. */
function ab(...args: string[]): string {
  const result = spawnSync("agent-browser", args, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    const stderr = result.stderr?.trim() ?? "";
    const stdout = result.stdout?.trim() ?? "";
    throw new Error(
      `agent-browser ${args.join(" ")} failed (exit ${result.status})\n${stderr || stdout}`,
    );
  }
  return result.stdout?.trim() ?? "";
}

/** Take a screenshot to the e2e/screenshots directory and log its path. */
function screenshot(label: string): void {
  const dir = path.join(__dirname, "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(dir, `${label}-${ts}.png`);
  try {
    ab("screenshot", file);
    console.log(`  [screenshot] ${file}`);
  } catch {
    console.warn(`  [screenshot] failed to capture ${label}`);
  }
}

/** Accessible name of the dev wallet adapter (see lib/dev-signer/solana-adapter.ts). */
const DEV_WALLET_NAME = "UTXOpia Dev Signer";

/** Persist dev keys into localStorage under DEV_KEYS_STORAGE_KEY so they
 *  survive the page reload that follows. Steps:
 *  1. Open APP_URL (establishes the origin, required before localStorage access).
 *  2. eval: seed both `__UTXOPIA_DEV_KEYS` and `walletName`.
 *  3. Open the actual target URL — DevSigner mounts, loadDevKeys() finds the
 *     stored value, and installs the wallet shims before the form renders.
 *
 *  localStorage survives navigation within the same origin, so this is robust
 *  against the reload that happens between step 2 and step 3.
 *
 *  `walletName` is what makes <WalletProvider autoConnect> reconnect: autoConnect
 *  only restores a *previously selected* wallet, so without this the Solana legs
 *  sit on "Connect wallet" forever and every token step fails. */
function injectDevKeysViaStorage(keys: DevKeys, targetUrl: string): void {
  // Step 1 — establish origin so localStorage is accessible.
  ab("open", APP_URL);
  // Step 2 — persist keys + pre-select the dev wallet.
  const script =
    `localStorage.setItem("__UTXOPIA_DEV_KEYS", ${JSON.stringify(JSON.stringify(keys))});` +
    `localStorage.setItem("walletName", ${JSON.stringify(JSON.stringify(DEV_WALLET_NAME))});`;
  ab("eval", "-b", Buffer.from(script).toString("base64"));
  // Step 3 — navigate to target; DevSigner reads localStorage on mount.
  ab("open", targetUrl);
}

/** Pick a token in the ShieldFlow dropdown. The trigger and each option carry
 *  data-testids because their visible labels are multi-line and not matchable
 *  by accessible name. */
function selectToken(symbol: string): void {
  ab("find", "testid", "token-selector-trigger", "click");
  ab("wait", "800");
  ab("find", "testid", `token-option-${symbol}`, "click");
  ab("wait", "1500");
}

/** Choose the withdraw destination network (Bitcoin vs Solana).
 *  Defaults to Bitcoin, so the Solana cash-out leg must switch explicitly. */
function selectCashOutDestination(destination: "bitcoin" | "solana"): void {
  ab("find", "testid", `cash-out-destination-${destination}`, "click");
  ab("wait", "1200");
}

// ---------------------------------------------------------------------------
// Step implementations
// ---------------------------------------------------------------------------

/** SHIELD step — Add funds privately */
async function stepShield(chain: ChainConfig, keys: DevKeys, amount: string): Promise<void> {
  const depositUrl = `${APP_URL}/vault/deposit?network=${chain.network}`;
  console.log(`  → Navigating to deposit: ${depositUrl}`);
  injectDevKeysViaStorage(keys, depositUrl);
  ab("wait", "--load", "networkidle");
  ab("wait", "--text", "Add funds"); // page heading

  // The dropdown defaults to BTC; the token loop runs on SOL.
  selectToken(SHIELD_TOKEN);

  // Amount + submit only render once the dev wallet is connected, which the
  // seeded `walletName` handles during injectDevKeysViaStorage.
  ab("wait", '[data-testid="shield-amount"]', "--timeout", "15000");
  ab("find", "testid", "shield-amount", "fill", amount);
  ab("wait", "500"); // brief settle for balance/canSubmit reactivity

  ab("find", "testid", "shield-submit", "click");

  ab("wait", '[data-testid="shield-success"]', "--timeout", "90000");
  console.log("  ✓ Shield success");
}

/** TRANSFER step — Private send to a stealth recipient */
async function stepTransfer(chain: ChainConfig, keys: DevKeys, amount: string, recipient: string): Promise<void> {
  const sendUrl = `${APP_URL}/send?network=${chain.network}`;
  console.log(`  → Navigating to send: ${sendUrl}`);
  injectDevKeysViaStorage(keys, sendUrl);
  ab("wait", "--load", "networkidle");
  ab("wait", "--text", "Send privately"); // page heading

  // Both fields are matched by <label>; `find role textbox` does not resolve
  // here, and the amount field only mounts once the recipient parses.
  ab("find", "label", "Recipient", "fill", recipient);
  ab("wait", "1000");
  ab("find", "label", "Amount", "fill", amount);
  ab("wait", "500");

  // Submit — opens the ReviewModal. Must not be matched as "Send": that also
  // matches "Send via claim link", which is a different flow.
  ab("find", "role", "button", "click", "--name", "Review private transfer");
  // UNVERIFIED: the ReviewModal only opens with a non-zero balance, so the
  // confirm control below could not be checked against a live app.
  ab("wait", "--text", "Confirm");
  ab("find", "role", "button", "click", "--name", "Confirm");

  ab("wait", "--text", "privately", "--timeout", "120000"); // covers "Sent privately" and "added privately"
  console.log("  ✓ Transfer success");
}

// ---------------------------------------------------------------------------
// BTC step implementations (only run when RUN_BTC=1)
// ---------------------------------------------------------------------------

/**
 * BTC DEPOSIT step — select BTC token, fill amount, preview, confirm & sign.
 *
 * The dev `window.unisat` shim (injected by DevSigner when NEXT_PUBLIC_DEV_SIGNER=1)
 * auto-signs the PSBT and broadcasts via the Esplora API, so no manual wallet
 * interaction is needed.
 *
 * After submission the backend deposit-tracker must:
 *   1. detect the BTC tx,
 *   2. wait for confirmations,
 *   3. sweep → mint zkBTC,
 *   4. insert the note into the user's inbox.
 *
 * We poll /vault/activity until a "Received" row appears (or we time out).
 *
 * UI flow (Solana devnet — ShieldFlow with isBtcNative branch):
 *   /vault/deposit → select BTC token → fill amount → "Add BTC privately" →
 *   BtcDepositPreview → "Confirm & Sign" → ShieldSuccess "BTC deposit submitted"
 */
async function stepBtcDeposit(chain: ChainConfig, keys: DevKeys): Promise<void> {
  const depositUrl = `${APP_URL}/vault/deposit?network=${chain.network}`;
  console.log(`  → BTC deposit: navigating to ${depositUrl}`);
  injectDevKeysViaStorage(keys, depositUrl);
  ab("wait", "--load", "networkidle");

  ab("wait", "--text", "Add funds"); // page heading
  selectToken("BTC");

  // The BTC amount field carries no placeholder — match it by its <label>.
  ab("find", "label", "Amount (sats)", "fill", BTC_DEPOSIT_AMOUNT_SATS);
  ab("wait", "500");

  // NOTE: on devnet-regtest the BTC branch renders the regtest faucet
  // ("Get private test BTC"), which credits the private vault directly — there
  // is no Connect BTC Wallet → PSBT preview → "Confirm & Sign" sequence. The
  // PSBT path below applies to the testnet4 wallet flow and is UNVERIFIED: the
  // BTC legs need the full backend stack (see README § BTC legs) to exercise.
  try {
    ab("find", "role", "button", "click", "--name", "Get private test BTC");
  } catch {
    ab("find", "role", "button", "click", "--name", "Add BTC privately");
    ab("wait", "--text", "Confirm & Sign", "--timeout", "20000");
    ab("find", "role", "button", "click", "--name", "Confirm & Sign");
  }
  ab("wait", "--text", "submitted", "--timeout", "60000");
  screenshot("btc-deposit-submitted");
  console.log("  ✓ BTC deposit broadcast");

  // Poll /vault/activity until a "Received" note appears (zkBTC minted).
  // This requires the deposit-tracker, BTC confirmations, sweep, and Ika
  // signing to complete — allow a generous timeout.
  const activityUrl = `${APP_URL}/vault/activity?network=${chain.network}`;
  console.log(`  → Polling for zkBTC note at ${activityUrl} (timeout ${BTC_DEPOSIT_TIMEOUT_MS}ms)…`);
  const deadline = Date.now() + BTC_DEPOSIT_TIMEOUT_MS;
  let minted = false;

  while (Date.now() < deadline) {
    injectDevKeysViaStorage(keys, activityUrl);
    ab("wait", "--load", "networkidle");
    try {
      // The activity page renders "Received" in each incoming note row.
      // Also accept "zkBTC Minted" which DepositStatusTracker shows at status=ready.
      ab("wait", "--text", "Received", "--timeout", "8000"); // UNVERIFIED: needs the deposit-tracker to mint a note.
      minted = true;
      break;
    } catch {
      const remaining = Math.round((deadline - Date.now()) / 1000);
      console.log(`  … note not yet visible; ${remaining}s remaining`);
      // Pacing comes from the re-inject + reload + 8s wait round-trip above;
      // no explicit sleep needed.
    }
  }

  if (!minted) {
    screenshot(`${chain.name.replace(/\s+/g, "-").toLowerCase()}-btc-deposit-timeout`);
    throw new Error(
      `BTC deposit: timed out after ${BTC_DEPOSIT_TIMEOUT_MS}ms waiting for zkBTC note to appear in activity.`,
    );
  }

  screenshot("btc-deposit-note-appeared");
  console.log("  ✓ BTC deposit note visible in activity");
}

/**
 * BTC REDEEM step — cash out zkBTC to a BTC address.
 *
 * UI flow (Solana devnet):
 *   /vault/withdraw → paste BTC address → fill amount → "Send" → ReviewModal
 *   "Hold to confirm" → redirect to /vault/activity?result=cashout_btc.
 *
 * Then poll until a "BTC Withdrawal" widget shows status "Confirmed" (the
 * withdrawal-status component) or until the activity result param appears.
 *
 * The backend redemption service + Ika MPC co-signing produce the BTC txid;
 * we wait for it to show up in the withdrawal-status tracker.
 */
async function stepBtcRedeem(chain: ChainConfig, keys: DevKeys): Promise<void> {
  const withdrawUrl = `${APP_URL}/vault/withdraw?network=${chain.network}`;
  console.log(`  → BTC redeem: navigating to ${withdrawUrl}`);
  injectDevKeysViaStorage(keys, withdrawUrl);
  ab("wait", "--load", "networkidle");
  ab("wait", "--text", "Take funds out"); // page heading

  // Bitcoin is the default destination, but assert it rather than assume.
  selectCashOutDestination("bitcoin");
  // NOTE: on regtest the app pins the payout to the connected test wallet and
  // pre-fills this field ("Regtest safety: BTC withdrawals can only go to your
  // connected test wallet"), so E2E_BTC_REDEEM_ADDR is ignored there.
  ab("find", "label", "Bitcoin address", "fill", BTC_REDEEM_ADDR);
  ab("wait", "1000");
  ab("find", "label", "Amount", "fill", BTC_REDEEM_AMOUNT);
  ab("wait", "500");
  ab("find", "role", "button", "click", "--name", "Review BTC withdrawal");
  // UNVERIFIED below: the review modal needs a non-zero private balance.
  ab("wait", "--text", "Hold to confirm", "--timeout", "10000");
  ab("find", "role", "button", "click", "--name", "Hold to confirm");

  // Wait for the app to navigate to the activity page with result=cashout_btc.
  // send-form.tsx line 458: router.push(`/vault/activity?result=cashout_btc`)
  ab("wait", "--url", "**/vault/activity**", "--timeout", "60000"); // UNVERIFIED: needs a submitted redeem to redirect.
  screenshot("btc-redeem-submitted");
  console.log("  ✓ BTC redeem submitted; polling for BTC txid…");

  // Poll /vault/withdraw (or the vault btc-widget panel) for the withdrawal
  // status tracker showing "Confirmed" or a BTC txid.  The WithdrawalStatusList
  // component renders inside the vault page; navigate there to poll.
  const vaultUrl = `${APP_URL}/vault?network=${chain.network}`;
  const deadline = Date.now() + BTC_REDEEM_TIMEOUT_MS;
  let confirmed = false;

  while (Date.now() < deadline) {
    injectDevKeysViaStorage(keys, vaultUrl);
    ab("wait", "--load", "networkidle");
    try {
      // WithdrawalStatusList renders "Confirmed" badge label from withdrawal-status.tsx line 37.
      ab("wait", "--text", "Confirmed", "--timeout", "8000"); // UNVERIFIED: needs the redemption service + Ika to confirm.
      confirmed = true;
      break;
    } catch {
      // Also accept a raw BTC txid substring (64 hex chars — any 8-char hex slug is a signal).
      try {
        ab("wait", "--text", "BTC TX", "--timeout", "3000"); // UNVERIFIED: needs a BTC txid from Ika MPC.
        confirmed = true;
        break;
      } catch {
        const remaining = Math.round((deadline - Date.now()) / 1000);
        console.log(`  … BTC txid not yet visible; ${remaining}s remaining`);
      }
    }
  }

  if (!confirmed) {
    screenshot(`${chain.name.replace(/\s+/g, "-").toLowerCase()}-btc-redeem-timeout`);
    throw new Error(
      `BTC redeem: timed out after ${BTC_REDEEM_TIMEOUT_MS}ms waiting for BTC txid/Confirmed status.`,
    );
  }

  screenshot("btc-redeem-confirmed");
  console.log("  ✓ BTC redeem confirmed");
}

/** UNSHIELD step — Cash out to a public address */
async function stepUnshield(chain: ChainConfig, keys: DevKeys, amount: string, addr: string): Promise<void> {
  const withdrawUrl = `${APP_URL}/vault/withdraw?network=${chain.network}`;
  console.log(`  → Navigating to withdraw: ${withdrawUrl}`);
  injectDevKeysViaStorage(keys, withdrawUrl);
  ab("wait", "--load", "networkidle");
  ab("wait", "--text", "Take funds out"); // page heading

  // The destination picker defaults to Bitcoin — switch to Solana first.
  selectCashOutDestination("solana");
  ab("find", "label", "Solana wallet address", "fill", addr);
  ab("wait", "1000");
  ab("find", "label", "Amount", "fill", amount);
  ab("wait", "500");
  // UNVERIFIED below: the review step needs a non-zero private balance.
  ab("find", "role", "button", "click", "--name", "Review cash out");
  ab("wait", "--text", "Confirm");
  ab("find", "role", "button", "click", "--name", "Confirm");

  ab("wait", "--text", "successfully", "--timeout", "120000"); // UNVERIFIED: needs a funded private balance.
  console.log("  ✓ Unshield success");
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function runChain(chain: ChainConfig, keys: DevKeys): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Chain: ${chain.name}`);
  console.log("=".repeat(60));

  const unshieldAddr = SOL_UNSHIELD_ADDR;

  try {
    console.log("\n[1/3] SHIELD");
    await stepShield(chain, keys, SHIELD_AMOUNT);

    console.log("\n[2/3] TRANSFER");
    await stepTransfer(chain, keys, TRANSFER_AMOUNT, TRANSFER_RECIPIENT);

    console.log("\n[3/3] UNSHIELD");
    await stepUnshield(chain, keys, UNSHIELD_AMOUNT, unshieldAddr);

    if (RUN_BTC) {
      console.log("\n[4/4] BTC DEPOSIT");
      await stepBtcDeposit(chain, keys);

      console.log("\n[5/4] BTC REDEEM");
      await stepBtcRedeem(chain, keys);
    }

    console.log(`\n✓ ${chain.name} token loop PASSED${RUN_BTC ? " (incl. BTC legs)" : ""}`);
  } catch (err) {
    const label = `${chain.name.replace(/\s+/g, "-").toLowerCase()}-failure`;
    console.error(`\n✗ ${chain.name} FAILED: ${err instanceof Error ? err.message : String(err)}`);
    screenshot(label);
    // Re-throw to signal overall failure
    throw err;
  } finally {
    // Close the browser session between chains so state doesn't bleed
    try {
      ab("close");
    } catch {
      // ignore close failures
    }
  }
}

async function main(): Promise<void> {
  console.log("UTXOpia token-loop E2E");
  console.log(`APP_URL: ${APP_URL}`);

  // Validate agent-browser is available
  try {
    execSync("agent-browser --version", { stdio: "pipe" });
  } catch {
    console.error(
      "ERROR: agent-browser not found. Install with:\n" +
        "  npm i -g agent-browser && agent-browser install",
    );
    process.exit(1);
  }

  // Load keys (throws with a descriptive message if not found)
  const keys = loadDevKeys();
  console.log("Dev keys loaded.");

  // Validate placeholder addresses haven't been left as-is
  if (
    TRANSFER_RECIPIENT.startsWith("REPLACE_") ||
    SOL_UNSHIELD_ADDR.startsWith("REPLACE_")
  ) {
    console.error(
      "ERROR: One or more placeholder addresses need replacing.\n" +
        "Set E2E_TRANSFER_RECIPIENT, E2E_SOL_UNSHIELD_ADDR\n" +
        "or edit the defaults in token-loop.e2e.ts.",
    );
    process.exit(1);
  }

  if (RUN_BTC) {
    console.log("BTC legs ENABLED (RUN_BTC=1).");
    if (BTC_REDEEM_ADDR.startsWith("REPLACE_")) {
      console.error(
        "ERROR: BTC legs require a real BTC address.\n" +
          "Set E2E_BTC_REDEEM_ADDR to a valid testnet/regtest bech32 address.",
      );
      process.exit(1);
    }
  }

  let anyFailed = false;
  for (const chain of CHAINS) {
    try {
      await runChain(chain, keys);
    } catch {
      anyFailed = true;
      // Continue to next chain so we get both results
    }
  }

  if (anyFailed) {
    console.error("\nOne or more chains FAILED. See screenshots above.");
    process.exit(1);
  }

  console.log("\nAll chains PASSED.");
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
