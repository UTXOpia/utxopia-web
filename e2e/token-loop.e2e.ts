#!/usr/bin/env bun
/**
 * token-loop.e2e.ts — Browser E2E for the dev-signer "token loop"
 *
 * Drives: SHIELD → TRANSFER → UNSHIELD on both Sui testnet and Solana devnet.
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
  suiSecretKey: string;
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

/** BTC deposit amount in BTC (≥ dust limit, well below funded amount). */
const BTC_DEPOSIT_AMOUNT = process.env.E2E_BTC_DEPOSIT_AMOUNT ?? "0.0001";

/** BTC redeem amount in sats (what to cash out). */
const BTC_REDEEM_AMOUNT = process.env.E2E_BTC_REDEEM_AMOUNT ?? "5000";

/** BTC address to receive the redeem payout (testnet / regtest address). */
const BTC_REDEEM_ADDR = process.env.E2E_BTC_REDEEM_ADDR ?? "REPLACE_WITH_BTC_ADDRESS"; // VERIFY: must be a valid testnet/regtest bech32 address

/** How long to poll for the BTC deposit note to appear (ms). Default 10 min. */
const BTC_DEPOSIT_TIMEOUT_MS = parseInt(process.env.BTC_DEPOSIT_TIMEOUT_MS ?? "600000", 10);

/** How long to poll for the BTC redeem txid to appear (ms). Default 10 min. */
const BTC_REDEEM_TIMEOUT_MS = parseInt(process.env.BTC_REDEEM_TIMEOUT_MS ?? "600000", 10);

const CHAINS: ChainConfig[] = [
  { name: "Sui testnet", networkParam: "sui-testnet", network: "sui-testnet" },
  { name: "Solana devnet", networkParam: "devnet", network: "devnet" },
];

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
/** Sui testnet: unshield destination (public 0x… address). */
const SUI_UNSHIELD_ADDR = process.env.E2E_SUI_UNSHIELD_ADDR ?? "REPLACE_WITH_SUI_ADDRESS"; // VERIFY: a valid 0x… Sui testnet address

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

/** Persist dev keys into localStorage under DEV_KEYS_STORAGE_KEY so they
 *  survive the page reload that follows. Steps:
 *  1. Open APP_URL (establishes the origin, required before localStorage access).
 *  2. eval: localStorage.setItem("__UTXOPIA_DEV_KEYS", JSON.stringify(keys)).
 *  3. Open the actual target URL — DevSigner mounts, loadDevKeys() finds the
 *     stored value, and installs the wallet shims before the form renders.
 *
 *  localStorage survives navigation within the same origin, so this is robust
 *  against the reload that happens between step 2 and step 3. */
function injectDevKeysViaStorage(keys: DevKeys, targetUrl: string): void {
  // Step 1 — establish origin so localStorage is accessible.
  ab("open", APP_URL);
  // Step 2 — persist keys.
  const payload = JSON.stringify(keys);
  const script = `localStorage.setItem("__UTXOPIA_DEV_KEYS", ${JSON.stringify(payload)});`;
  const b64 = Buffer.from(script).toString("base64");
  ab("eval", "-b", b64);
  // Step 3 — navigate to target; DevSigner reads localStorage on mount.
  ab("open", targetUrl);
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
  // DevSigner activates on mount — wait for the form to appear
  ab("wait", "--text", "Add"); // "Add funds" page title or button // VERIFY: page loads with "Add" text

  // For Sui: the SuiShieldFlow renders "Add <TOKEN> privately" button
  // For Solana: the ShieldFlow renders "Add <TOKEN> privately" button
  // Both flows auto-select Self as the recipient (defaultToSelf=true in StealthRecipientInput)

  // Fill amount
  // The amount input has placeholder "0.00" (Solana) or similar (Sui)
  ab("find", "placeholder", "0.00", "fill", amount); // VERIFY: placeholder exact text; Sui may use different placeholder
  ab("wait", "500"); // brief settle for balance/canSubmit reactivity

  // Submit — the primary button contains "Add" + "privately"
  ab("find", "role", "button", "click", "--name", `Add`); // VERIFY: button text starts with "Add"; use snapshot to confirm exact name if needed

  // Wait for success — both Solana ("Funds added privately") and Sui ("Funds added privately")
  ab("wait", "--text", "Funds added privately", "--timeout", "90000");
  console.log("  ✓ Shield success");
}

/** TRANSFER step — Private send to a stealth recipient */
async function stepTransfer(chain: ChainConfig, keys: DevKeys, amount: string, recipient: string): Promise<void> {
  const sendUrl = `${APP_URL}/send?network=${chain.network}`;
  console.log(`  → Navigating to send: ${sendUrl}`);
  injectDevKeysViaStorage(keys, sendUrl);
  ab("wait", "--load", "networkidle");
  ab("wait", "--text", "Send"); // page title // VERIFY: page has "Send" heading

  if (chain.name.startsWith("Sui")) {
    // SuiSendFlow: amount field first, then recipient
    // The SuiTokenAmountField amount input has placeholder "0.00" or similar
    ab("find", "placeholder", "0.00", "fill", amount); // VERIFY placeholder
    ab("wait", "300");
    // Recipient: placeholder "utxo:… · alice.utxopia.sui · 0x…"
    ab("find", "placeholder", "utxo:…", "fill", recipient); // VERIFY: exact placeholder from sui-send-flow.tsx line 302
    ab("wait", "1000"); // allow stealth address detection to trigger
  } else {
    // Solana SendForm: RecipientInput then AmountField
    // RecipientInput placeholder is variable; locate by role first then fill
    ab("find", "role", "textbox", "fill", recipient); // VERIFY: may need snapshot to pick correct input
    ab("wait", "500");
    ab("find", "placeholder", "0.00", "fill", amount); // VERIFY placeholder
    ab("wait", "300");
  }

  // Submit — button text is "Send <TOKEN>" on Sui; "Review" or "Send" on Solana
  // Sui: SuiSubmitButton idleLabel = `Send ${selected.symbol}`
  // Solana: opens ReviewModal first
  ab("find", "role", "button", "click", "--name", "Send"); // VERIFY: on Solana this opens Review modal; on Sui it submits

  if (!chain.name.startsWith("Sui")) {
    // Solana shows a ReviewModal; confirm inside it
    ab("wait", "--text", "Confirm"); // VERIFY: ReviewModal has a Confirm button
    ab("find", "role", "button", "click", "--name", "Confirm"); // VERIFY: exact button text
  }

  // Success: Sui = "Sent privately", Solana = flow-specific success text
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
 *
 * For Sui testnet the BTC deposit routes via the faucet/regtest path and is
 * only available on hybrid (regtest) networks.  On non-hybrid Sui we skip
 * gracefully (the BTC option is disabled in the UI).
 */
async function stepBtcDeposit(chain: ChainConfig, keys: DevKeys): Promise<void> {
  const depositUrl = `${APP_URL}/vault/deposit?network=${chain.network}`;
  console.log(`  → BTC deposit: navigating to ${depositUrl}`);
  injectDevKeysViaStorage(keys, depositUrl);
  ab("wait", "--load", "networkidle");

  if (chain.name.startsWith("Sui")) {
    // Sui hybrid: BTC deposit goes via /faucet?address=... page.
    // The deposit card at /vault/deposit shows a "Deposit regtest BTC" link.
    // Click through and submit the faucet form.
    ab("wait", "--text", "Deposit regtest BTC", "--timeout", "15000"); // VERIFY: link text from deposit-adapters.tsx
    ab("find", "role", "link", "click", "--name", "Deposit regtest BTC"); // VERIFY: exact link label
    ab("wait", "--load", "networkidle");
    // Faucet page: fill amount and submit
    ab("find", "placeholder", "0.00000000", "fill", BTC_DEPOSIT_AMOUNT); // VERIFY: faucet amount input placeholder
    ab("wait", "500");
    ab("find", "role", "button", "click", "--name", "Deposit"); // VERIFY: faucet submit button text
    // Faucet redirects to /vault/activity?result=deposit_btc after broadcast
    ab("wait", "--text", "deposit", "--timeout", "30000"); // VERIFY: success signal on faucet
  } else {
    // Solana devnet: ShieldFlow with BTC token.
    // The token selector defaults to the first token; we need to switch to BTC.
    ab("wait", "--text", "Add Funds"); // page title from SolanaDepositPage // VERIFY

    // Open the token selector dropdown and pick BTC.
    // TokenSelector renders the currently selected token symbol inside a button.
    ab("find", "role", "button", "click", "--name", "BTC"); // VERIFY: token selector shows "BTC" when BTC is selected — click it to open dropdown first if needed
    ab("wait", "500");
    // If BTC is not the default token, the dropdown opens — pick it.
    // The dropdown renders each token as a button with its symbol.
    // If BTC was already selected, the above click re-opens then closes — harmless.
    // Fallback: directly look for the BTC option in the open dropdown.
    try {
      ab("find", "role", "option", "click", "--name", "BTC"); // VERIFY: dropdown option text; may be listitem not option
    } catch {
      // BTC was likely already selected — continue.
    }
    ab("wait", "500");

    // The BTC flow shows "Connect BTC Wallet" button when unisat is not yet connected.
    // DevSigner installs window.unisat shim on mount; click "Connect BTC Wallet" then
    // pick "UniSat" from the wallet picker.
    try {
      ab("wait", "--text", "Connect BTC Wallet", "--timeout", "5000"); // VERIFY
      ab("find", "role", "button", "click", "--name", "Connect BTC Wallet"); // VERIFY
      ab("wait", "500");
      ab("find", "role", "button", "click", "--name", "UniSat"); // VERIFY: wallet picker option label
      ab("wait", "1000");
    } catch {
      // Already connected (e.g. from a previous step) — continue.
    }

    // Fill the BTC amount (placeholder "0.00000000" from shield-flow.tsx line 428).
    ab("find", "placeholder", "0.00000000", "fill", BTC_DEPOSIT_AMOUNT); // VERIFY: exact placeholder
    ab("wait", "500");

    // Click "Add BTC privately" to build the PSBT preview.
    ab("find", "role", "button", "click", "--name", "Add BTC privately"); // VERIFY: button text from shield-flow.tsx line 487
    ab("wait", "--text", "Confirm & Sign", "--timeout", "20000"); // VERIFY: BtcDepositPreview renders this button

    // Confirm and sign — DevSigner shim auto-approves.
    ab("find", "role", "button", "click", "--name", "Confirm & Sign"); // VERIFY: button text from btc-deposit-preview.tsx line 164
    ab("wait", "--text", "BTC deposit submitted", "--timeout", "60000"); // VERIFY: ShieldSuccess h3 text from shield-success.tsx line 38
    screenshot("btc-deposit-submitted");
    console.log("  ✓ BTC deposit broadcast");
  }

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
      ab("wait", "--text", "Received", "--timeout", "8000"); // VERIFY: ActivityRow "Received" label from activity/page.tsx line 111
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
  ab("wait", "--text", "Cash out"); // page title from withdraw/page.tsx // VERIFY

  if (chain.name.startsWith("Sui")) {
    // Sui cash-out to BTC: SuiSendFlow — recipient-aware.
    // Enter a BTC address; the flow detects it and switches to redeem mode.
    ab("find", "placeholder", "utxo:…", "fill", BTC_REDEEM_ADDR); // VERIFY: placeholder from sui-send-flow.tsx
    ab("wait", "1000");
    ab("find", "placeholder", "0.00", "fill", BTC_REDEEM_AMOUNT); // VERIFY: amount field placeholder
    ab("wait", "500");
    ab("find", "role", "button", "click", "--name", "Cash out"); // VERIFY: SuiSubmitButton idleLabel
  } else {
    // Solana cash-out to BTC: SendForm.
    // RecipientInput placeholder: "Paste address, alice.utxopia.sui, or .utxopia.sol name"
    ab("find", "placeholder", "Paste address", "fill", BTC_REDEEM_ADDR); // VERIFY: placeholder from recipient-input.tsx line 95
    ab("wait", "1000");
    // After a valid BTC address is detected, the amount field appears.
    ab("find", "placeholder", "0.00", "fill", BTC_REDEEM_AMOUNT); // VERIFY: AmountField placeholder
    ab("wait", "500");
    // The "Send" button opens the ReviewModal.
    ab("find", "role", "button", "click", "--name", "Send"); // VERIFY: send-form.tsx line 613
    // ReviewModal shows "Hold to confirm" (HoldButton from review-modal.tsx line 79).
    ab("wait", "--text", "Hold to confirm", "--timeout", "10000"); // VERIFY
    // Hold the button — agent-browser simulates a hold via a long click or hold action.
    ab("find", "role", "button", "click", "--name", "Hold to confirm"); // VERIFY: HoldButton accessible name — may need "hold" action instead of "click"
  }

  // Wait for the app to navigate to the activity page with result=cashout_btc.
  // send-form.tsx line 458: router.push(`/vault/activity?result=cashout_btc`)
  ab("wait", "--url", "**/vault/activity**", "--timeout", "60000"); // VERIFY: agent-browser URL glob syntax
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
      ab("wait", "--text", "Confirmed", "--timeout", "8000"); // VERIFY: status label from withdrawal-status.tsx
      confirmed = true;
      break;
    } catch {
      // Also accept a raw BTC txid substring (64 hex chars — any 8-char hex slug is a signal).
      try {
        ab("wait", "--text", "BTC TX", "--timeout", "3000"); // VERIFY: "BTC TX" label in WithdrawalCard row
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
  ab("wait", "--text", "Cash out"); // page title // VERIFY

  if (chain.name.startsWith("Sui")) {
    // SuiSendFlow (same component as send, but framed as cash out)
    ab("find", "placeholder", "0.00", "fill", amount); // VERIFY placeholder
    ab("wait", "300");
    // Public Sui address triggers unshield mode
    ab("find", "placeholder", "utxo:…", "fill", addr); // VERIFY placeholder
    ab("wait", "1000");
    ab("find", "role", "button", "click", "--name", "Cash out"); // VERIFY: SuiSubmitButton idleLabel = "Cash out <TOKEN>"
  } else {
    // Solana SendForm with showClaimLink=false
    ab("find", "role", "textbox", "fill", addr); // VERIFY
    ab("wait", "500");
    ab("find", "placeholder", "0.00", "fill", amount); // VERIFY
    ab("wait", "300");
    ab("find", "role", "button", "click", "--name", "Send"); // VERIFY
    ab("wait", "--text", "Confirm"); // VERIFY
    ab("find", "role", "button", "click", "--name", "Confirm"); // VERIFY
  }

  // Sui success: "Cashed out" (SuiFlowSuccess title on unshield mode)
  // Solana: transaction success text varies; wait for "success" or explorer link
  const successText = chain.name.startsWith("Sui") ? "Cashed out" : "successfully"; // VERIFY Solana success text
  ab("wait", "--text", successText, "--timeout", "120000");
  console.log("  ✓ Unshield success");
}

// ---------------------------------------------------------------------------
// Main runner
// ---------------------------------------------------------------------------

async function runChain(chain: ChainConfig, keys: DevKeys): Promise<void> {
  console.log(`\n${"=".repeat(60)}`);
  console.log(`Chain: ${chain.name}`);
  console.log("=".repeat(60));

  const unshieldAddr = chain.name.startsWith("Sui") ? SUI_UNSHIELD_ADDR : SOL_UNSHIELD_ADDR;

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
    SOL_UNSHIELD_ADDR.startsWith("REPLACE_") ||
    SUI_UNSHIELD_ADDR.startsWith("REPLACE_")
  ) {
    console.error(
      "ERROR: One or more placeholder addresses need replacing.\n" +
        "Set E2E_TRANSFER_RECIPIENT, E2E_SOL_UNSHIELD_ADDR, E2E_SUI_UNSHIELD_ADDR\n" +
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
