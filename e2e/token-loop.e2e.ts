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

/** Esplora base used to confirm the BTC payout actually landed. */
const ESPLORA_URL = process.env.E2E_ESPLORA_URL ?? "https://btc.utxopia.com/regtest";

/** BTC-leg feature flag — set RUN_BTC=1 to enable BTC deposit + redeem steps.
 *  Requires the full backend stack (see README § BTC legs). */
const RUN_BTC = process.env.RUN_BTC === "1";

/** Run only the BTC legs (requires RUN_BTC=1). See runChain for why. */
const SKIP_TOKEN_LOOP = process.env.SKIP_TOKEN_LOOP === "1";

/** Skip the deposit leg when the vault already holds zkBTC — the redeem leg
 *  only needs a balance, and re-depositing costs a 10-minute poll. */
const SKIP_BTC_DEPOSIT = process.env.SKIP_BTC_DEPOSIT === "1";

/** BTC deposit amount in sats — the deposit field is denominated in sats
 *  ("Amount (sats)"), not BTC. 10_000 sats = 0.0001 BTC. */
const BTC_DEPOSIT_AMOUNT_SATS = process.env.E2E_BTC_DEPOSIT_AMOUNT_SATS ?? "10000";

/** BTC redeem amount in sats (what to cash out). */
const BTC_REDEEM_AMOUNT_SATS = process.env.E2E_BTC_REDEEM_AMOUNT ?? "4000";

/** The withdraw form's "Amount" is denominated in whole BTC — only the *deposit*
 *  form is labelled "Amount (sats)". Filling the sats figure straight in asked
 *  for 5000 BTC and the submit died with "outputs require 500000000500 sats". */
const BTC_REDEEM_AMOUNT_BTC = (Number(BTC_REDEEM_AMOUNT_SATS) / 1e8).toFixed(8);

/** BTC address to receive the redeem payout (testnet / regtest address). */
const BTC_REDEEM_ADDR = process.env.E2E_BTC_REDEEM_ADDR ?? "REPLACE_WITH_BTC_ADDRESS"; // VERIFY: must be a valid testnet/regtest bech32 address

/** How long to poll for the BTC deposit note to appear (ms). Default 10 min. */
const BTC_DEPOSIT_TIMEOUT_MS = parseInt(process.env.BTC_DEPOSIT_TIMEOUT_MS ?? "600000", 10);

/** How long to poll for the BTC redeem txid to appear (ms). Default 10 min. */
const BTC_REDEEM_TIMEOUT_MS = parseInt(process.env.BTC_REDEEM_TIMEOUT_MS ?? "600000", 10);

/** Which network the run drives, via `?network=`. Both `devnet` and
 *  `devnet-regtest` sit on Solana devnet and are served by api-hybrid; they
 *  differ in program id and in whether BTC is testnet4 or regtest. The BTC legs
 *  here mine regtest blocks, so they only make sense on `devnet-regtest`. */
const E2E_NETWORK = process.env.E2E_NETWORK ?? "devnet";

const CHAINS: ChainConfig[] = [
  { name: `Solana ${E2E_NETWORK}`, networkParam: E2E_NETWORK, network: E2E_NETWORK },
];

/** Token symbol driven by the loop; must match a token-option-<symbol> testid. */
const SHIELD_TOKEN = process.env.E2E_SHIELD_TOKEN ?? "SOL";

/** Amount to shield / transfer / unshield per step.
 *  Must be well below the funded balance. Adjust per funded amount. */
/** The private-balance symbol the shield produces, e.g. SOL -> zkSOL. */
const SHIELDED_TOKEN = `zk${SHIELD_TOKEN}`;

const SHIELD_AMOUNT = "0.01";
const TRANSFER_AMOUNT = "0.005";
const UNSHIELD_AMOUNT = "0.004";

/** Stealth recipient for the transfer step.
 *
 *  A fixed address is deliberate: the transfer leg is testing that a private
 *  send builds, proves and lands, not that we can spend it afterwards. Pinning
 *  it keeps runs reproducible and removes a per-run derivation step — the app
 *  only ever shows a *truncated* meta address, and the one on the deposit page
 *  is a one-time deposit address, not this. Override to send somewhere you can
 *  actually spend from. */
const TRANSFER_RECIPIENT = process.env.E2E_TRANSFER_RECIPIENT
  ?? "utxo:90935e024056c1aa69bc32cb662c45ce2fde0670ccc7ac3d60b03c55b88dc327"
   + "e100efc857a86fba2496f7d4adb8820a88cd9666c8d566ad2e5942dbad2722142"
   + "0d1c6f0b7149af92212486a9a42055e263749255f968dfcccc7b7eb5e9aa102";

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
/** The daemon's IPC read returns EAGAIN while the renderer is pegged — which it
 *  is for a minute at a time during in-browser WASM proof generation. The CLI
 *  gives up after its own 5 retries and exits 1, so a busy daemon is
 *  indistinguishable from a real failure unless you read the message. Retry
 *  that case only: a timed-out wait or a missing element is a real result and
 *  must still fail. Both the daemon and Chrome survive this, so retrying works.
 */
const DAEMON_BUSY = /Resource temporarily unavailable|daemon may be busy|os error 35/i;
const AB_ATTEMPTS = 4;

function ab(...args: string[]): string {
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync("agent-browser", args, {
      encoding: "utf-8",
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status === 0) return result.stdout?.trim() ?? "";

    const message = (result.stderr?.trim() || result.stdout?.trim()) ?? "";
    if (attempt >= AB_ATTEMPTS || !DAEMON_BUSY.test(message)) {
      throw new Error(
        `agent-browser ${args.join(" ")} failed (exit ${result.status})\n${message}`,
      );
    }
    console.log(`  … browser daemon busy, retrying (${attempt}/${AB_ATTEMPTS - 1})`);
    execSync(`sleep ${attempt * 5}`);
  }
}

/** Wait for text, polling in short slices instead of one long block.
 *
 *  A single `wait --text X --timeout 120000` asks the daemon to block far longer
 *  than the CLI is willing to wait on its IPC read, so it reports the daemon as
 *  unresponsive and exits 1 — a failure indistinguishable from "the text never
 *  appeared". Every failure this harness has hit was on a long wait (60s/120s/
 *  180s); the deposit leg's loop of 8s waits never once tripped it. So keep each
 *  request short and do the waiting here.
 */
function waitForText(text: string, totalMs: number): void {
  waitForAnyText([text], totalMs);
}

/** Same, but satisfied by whichever of several strings shows up first. Used
 *  where one step has two legitimate outcomes — e.g. the BTC deposit renders the
 *  regtest faucet's "Private BTC balance updated" but the testnet4 wallet flow's
 *  "submitted", and which one you get depends on the network. */
function waitForAnyText(texts: string[], totalMs: number): void {
  const deadline = Date.now() + totalMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    for (const text of texts) {
      try {
        ab("wait", "--text", text, "--timeout", "8000");
        return;
      } catch (err) {
        lastError = err;
      }
    }
  }
  // Say what the page actually showed. Without this a timeout is unfalsifiable:
  // you cannot tell a wrong expected string from a step that never ran, and the
  // screenshot is taken later, by which point transient banners have gone.
  let onScreen = "<unavailable>";
  try {
    onScreen = ab(
      "eval",
      "location.pathname + ' :: ' + document.body.innerText.replace(/\\s+/g,' ').slice(0,600)",
    );
  } catch {
    // Page unreadable — the message below still names what was expected.
  }
  throw new Error(
    `timed out after ${totalMs}ms waiting for any of ${JSON.stringify(texts)}\n` +
      `page showed: ${onScreen}\n` +
      `${lastError instanceof Error ? lastError.message : String(lastError)}`,
  );
}

/** Best-effort "page settled" hint.
 *
 *  `wait --load networkidle` blocks for the 30s default, which is already longer
 *  than the CLI will wait on its IPC read — so on a busy page it reports the
 *  daemon as unresponsive instead of settling. Ask for a short slice and move on
 *  either way: this is a readiness hint, never an assertion. The explicit text
 *  and element waits that follow are what actually gate each step.
 */
function waitIdle(): void {
  try {
    ab("wait", "--load", "networkidle", "--timeout", "8000");
  } catch {
    // Not settled within the slice — the next explicit wait decides the outcome.
  }
}

/** Mine regtest blocks. Nothing mines on its own, so a BTC payout sits in the
 *  mempool forever, and the redemption then waits on *finality* — the light
 *  client finalises a few blocks back, so confirming the payout is not enough
 *  ("block 494 > finalized 490"). Both stages need blocks to keep coming. */
function mineRegtest(blocks: number): void {
  try {
    execSync(
      `curl -s -X POST "${APP_URL}/api/regtest/mine?network=devnet-regtest" ` +
        `-H 'Content-Type: application/json' -d '{"blocks":${blocks}}' --max-time 60`,
      { stdio: "pipe" },
    );
  } catch {
    // Not a regtest deployment, or the miner is unavailable — the poll below
    // still decides the outcome.
  }
}

/** Sats received at the BTC payout address, confirmed + mempool.
 *
 *  This is the ground truth for "the cash-out arrived", and it is external to
 *  the app. The alternatives do not work: /vault renders no withdrawal status,
 *  the activity page hides it inside an expanded row, and
 *  /api/explorer/redemptions scans redemption PDAs — which complete_redemption
 *  closes, so a *successful* redemption vanishes from that feed.
 */
function payoutSats(address: string): number {
  try {
    const raw = execSync(
      `curl -s "${ESPLORA_URL}/api/address/${address}" --max-time 30`,
      { encoding: "utf-8", stdio: "pipe" },
    );
    const d = JSON.parse(raw) as {
      chain_stats?: { funded_txo_sum?: number };
      mempool_stats?: { funded_txo_sum?: number };
    };
    return (d.chain_stats?.funded_txo_sum ?? 0) + (d.mempool_stats?.funded_txo_sum ?? 0);
  } catch {
    return -1;
  }
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

/** Unlock this pool's private identity, if the page is gating on it.
 *
 *  The identity is per-pool and is *derived at first unlock* from a wallet
 *  signature — hydration can only restore one that already exists, so a fresh
 *  browser profile always meets this wall. Until it clears, the amount field
 *  never mounts and the submit button stays disabled, which reads exactly like
 *  a hung proof: the run then waits out the success selector for nothing.
 *
 *  The component unmounts once keys exist, so a miss here means "already
 *  unlocked" and is not an error. The dev adapter implements signMessage, so
 *  the signature is granted without a prompt.
 */
function unlockVaultIdentity(): void {
  try {
    ab("find", "testid", "vault-identity-unlock", "click");
  } catch {
    return; // No gate on screen — this pool's identity is already unlocked.
  }
  console.log("  → Unlocking the pool's private identity…");
  ab("wait", "6000");
}

/** Pick a token in the ShieldFlow dropdown. The trigger and each option carry
 *  data-testids because their visible labels are multi-line and not matchable
 *  by accessible name. */
/** Click a button by label, scrolling to it first.
 *
 *  agent-browser's click does not scroll, and every primary action here sits
 *  below the fold on a laptop viewport — the click then lands on nothing and
 *  the run waits out the next selector instead of failing where it broke.
 */
function clickButton(name: string): void {
  ab(
    "eval",
    `Array.from(document.querySelectorAll('button'))` +
      `.find(b => b.innerText.trim().startsWith(${JSON.stringify(name)}))` +
      `?.scrollIntoView({ block: 'center' })`,
  );
  ab("wait", "300");
  ab("find", "role", "button", "click", "--name", name);
}

function selectToken(symbol: string): void {
  ab("scrollintoview", '[data-testid="token-selector-trigger"]');
  ab("wait", "300");
  ab("find", "testid", "token-selector-trigger", "click");
  ab("wait", "800");
  ab("find", "testid", `token-option-${symbol}`, "click");
  ab("wait", "1500");
}

/** Choose the withdraw destination network (Bitcoin vs Solana).
 *  Defaults to Bitcoin, so the Solana cash-out leg must switch explicitly. */
/** Switch the "From" private-balance asset on the send / withdraw pages.
 *
 *  Both default to zkBTC. Left alone, the loop shields one asset and then
 *  spends a different one — the transfer drains whatever zkBTC happened to be
 *  lying around and the unshield fails with "No available private notes can
 *  cover this amount", which reads like a bug but is just the legs disagreeing.
 */
function selectSourceToken(shieldedSymbol: string): void {
  // The picker sits at the bottom of both flows and agent-browser does not
  // scroll before clicking, so without this the trigger click lands on nothing
  // and the failure surfaces as a missing *option*, one step later.
  ab("scrollintoview", '[data-testid="token-source-trigger"]');
  ab("wait", "300");
  ab("find", "testid", "token-source-trigger", "click");
  ab("wait", "500");
  ab("find", "testid", `token-source-${shieldedSymbol}`, "click");
  ab("wait", "1000");
}

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
  waitIdle();
  waitForText("Add funds", 30000); // page heading

  // The dropdown defaults to BTC; the token loop runs on SOL.
  selectToken(SHIELD_TOKEN);

  unlockVaultIdentity();

  // Amount + submit only render once the dev wallet is connected, which the
  // seeded `walletName` handles during injectDevKeysViaStorage.
  ab("wait", '[data-testid="shield-amount"]', "--timeout", "15000");
  ab("find", "testid", "shield-amount", "fill", amount);
  ab("wait", "500"); // brief settle for balance/canSubmit reactivity

  // The submit sits below the fold on a laptop viewport and agent-browser's
  // click does not scroll to it — the click lands on nothing and the run then
  // waits out the success selector for no reason.
  ab("scrollintoview", '[data-testid="shield-submit"]');
  ab("find", "testid", "shield-submit", "click");

  ab("wait", '[data-testid="shield-success"]', "--timeout", "90000");
  console.log("  ✓ Shield success");
}

/** TRANSFER step — Private send to a stealth recipient */
async function stepTransfer(chain: ChainConfig, keys: DevKeys, amount: string, recipient: string): Promise<void> {
  const sendUrl = `${APP_URL}/send?network=${chain.network}`;
  console.log(`  → Navigating to send: ${sendUrl}`);
  injectDevKeysViaStorage(keys, sendUrl);
  waitIdle();
  waitForText("Send privately", 30000); // page heading

  // Both fields are matched by <label>; `find role textbox` does not resolve
  // here, and the amount field only mounts once the recipient parses.
  ab("find", "label", "Recipient", "fill", recipient);
  ab("wait", "1000");
  // Only now does the asset picker exist — before a recipient parses, the
  // "From" row is the vault selector, not the private-balance one.
  selectSourceToken(SHIELDED_TOKEN);
  ab("find", "label", "Amount", "fill", amount);
  ab("wait", "500");

  // Submit — opens the ReviewModal. Must not be matched as "Send": that also
  // matches "Send via claim link", which is a different flow.
  clickButton("Review private transfer");
  // The review modal confirms via HoldButton, labelled "Hold to confirm". With
  // NEXT_PUBLIC_DEV_SIGNER=1 it wires onClick straight to onComplete, so a
  // plain click is enough; without it this would need a real press-and-hold.
  waitForText("Hold to confirm", 30000);
  clickButton("Hold to confirm");

  // "View on explorer" renders only in the modal's success view, and only once
  // a signature came back. Anything looser is a false pass: the previous wait
  // matched "privately" — which is already in the "Send privately" heading, so
  // it returned before the transfer was even submitted.
  waitForText("View on explorer", 120000);
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
  waitIdle();

  waitForText("Add funds", 30000); // page heading
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
    clickButton("Get private test BTC");
  } catch {
    clickButton("Add BTC privately");
    ab("wait", "--text", "Confirm & Sign", "--timeout", "20000");
    clickButton("Confirm & Sign");
  }
  // regtest credits the vault directly via the faucet; testnet4 goes through the
  // wallet PSBT flow. Accept whichever this network actually renders.
  waitForAnyText(["Private BTC balance updated", "submitted"], 60000);
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
    waitIdle();
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
  // Baseline first: a redemption that settled on an earlier run must not count
  // as this one succeeding.
  const payoutBefore = payoutSats(BTC_REDEEM_ADDR);
  const withdrawUrl = `${APP_URL}/vault/withdraw?network=${chain.network}`;
  console.log(`  → BTC redeem: navigating to ${withdrawUrl}`);
  injectDevKeysViaStorage(keys, withdrawUrl);
  waitIdle();
  waitForText("Take funds out", 30000); // page heading

  // Bitcoin is the default destination, but assert it rather than assume.
  selectCashOutDestination("bitcoin");
  // NOTE: on regtest the app pins the payout to the connected test wallet and
  // pre-fills this field ("Regtest safety: BTC withdrawals can only go to your
  // connected test wallet"), so E2E_BTC_REDEEM_ADDR is ignored there.
  ab("find", "label", "Bitcoin address", "fill", BTC_REDEEM_ADDR);
  ab("wait", "1000");
  ab("find", "label", "Amount", "fill", BTC_REDEEM_AMOUNT_BTC);
  ab("wait", "500");
  clickButton("Review BTC withdrawal");
  // UNVERIFIED below: the review modal needs a non-zero private balance.
  ab("wait", "--text", "Hold to confirm", "--timeout", "10000");
  clickButton("Hold to confirm");

  // No redirect happens here: send-form only pushes /vault/activity from
  // onViewActivity, i.e. when the user clicks "View activity". Submitting leaves
  // the modal open on its success view, so assert on that — the same signal the
  // token legs use, and the only one that implies a real signature.
  // Same budget as the unshield leg. A redeem proof is a JoinSplit plus the BTC
  // script binding and takes well over a minute in-browser; the 60s this used to
  // allow expired mid-proof, which reads as a product failure but is not one.
  waitForText("View on explorer", 180000);
  screenshot("btc-redeem-submitted");
  console.log("  ✓ BTC redeem submitted; polling for BTC txid…");

  // Poll the redemption feed for settlement. Not the UI: /vault renders no
  // withdrawal status at all, and on the activity page the status lives inside
  // an expanded row behind two onboarding modals.
  const deadline = Date.now() + BTC_REDEEM_TIMEOUT_MS;
  let confirmed = false;

  while (Date.now() < deadline) {
    // Keep blocks coming: the payout needs confirmations, then the redemption
    // needs the light client to finalise that block. Both stall without this.
    // Keep blocks coming: the payout needs confirmations, and then the
    // redemption needs the light client to finalise that block. Both stall
    // without this — nothing mines on regtest.
    mineRegtest(2);
    const payoutNow = payoutSats(BTC_REDEEM_ADDR);
    if (payoutNow > payoutBefore) {
      console.log(`  → payout received: ${payoutNow - payoutBefore} sats`);
      confirmed = true;
      break;
    }
    const remaining = Math.round((deadline - Date.now()) / 1000);
    console.log(`  … BTC payout not received yet (${payoutNow} sats at destination); ${remaining}s remaining`);
    execSync("sleep 10");
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
  waitIdle();
  waitForText("Take funds out", 30000); // page heading

  // The destination picker defaults to Bitcoin — switch to Solana first.
  selectCashOutDestination("solana");
  ab("find", "label", "Solana wallet address", "fill", addr);
  ab("wait", "1000");
  selectSourceToken(SHIELDED_TOKEN);
  ab("find", "label", "Amount", "fill", amount);
  ab("wait", "500");
  clickButton("Review cash out");
  waitForText("Hold to confirm", 30000);
  clickButton("Hold to confirm");

  // The submission does NOT redirect: send-form keeps the user on the page and
  // the modal shows the confirmed result inline, with "View activity" as an
  // explicit action. So assert on the success view — waiting for a
  // /vault/activity URL just burns the timeout and wedges the browser daemon.
  waitForText("View on explorer", 180000);
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
    if (SKIP_TOKEN_LOOP) {
      // The BTC legs stand on their own — the deposit mints the zkBTC the redeem
      // spends — and each is a long poll that re-navigates every iteration. Being
      // able to run them without the token loop first halves the browser work and
      // stops an unrelated SOL failure from gating them.
      console.log("\nToken loop SKIPPED (SKIP_TOKEN_LOOP=1).");
    } else {
      console.log("\n[1/3] SHIELD");
      await stepShield(chain, keys, SHIELD_AMOUNT);

      console.log("\n[2/3] TRANSFER");
      await stepTransfer(chain, keys, TRANSFER_AMOUNT, TRANSFER_RECIPIENT);

      console.log("\n[3/3] UNSHIELD");
      await stepUnshield(chain, keys, UNSHIELD_AMOUNT, unshieldAddr);
    }

    if (RUN_BTC) {
      if (SKIP_BTC_DEPOSIT) {
        console.log("\n[4/4] BTC DEPOSIT SKIPPED (SKIP_BTC_DEPOSIT=1)");
      } else {
        console.log("\n[4/4] BTC DEPOSIT");
        await stepBtcDeposit(chain, keys);
      }

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
