#!/usr/bin/env bun
/**
 * beta-invite.e2e.ts — the invited member's whole journey, driven in a browser.
 *
 *   MINT → FUND → REDEEM → DEPOSIT → TRANSFER → EXIT DRILL → FEEDBACK → RESTORE
 *
 * This is not `token-loop.e2e.ts` with an extra step. That one drives the Open
 * vault with a wallet that already has funds; this one starts from nothing and
 * asks the question the beta actually rests on: can somebody who was handed a
 * code get in, move money, and get it back out without us?
 *
 * ## Every run burns a code and a wallet. That is not a bug.
 *
 * A code binds to the first wallet that redeems it, and a wallet can hold one
 * membership ever (`invite.rs`, partial unique index on `redeemed_by`). So the
 * run cannot be idempotent: it mints a fresh code, generates a fresh keypair,
 * and leaves behind a permanent on-chain membership. Do not put this in CI on
 * every push. It is a pre-launch gate and a post-deploy smoke test, run
 * deliberately, and each run costs one row in the ledger.
 *
 * Codes minted here are labelled `e2e-dryrun` with a 1-day expiry so they are
 * distinguishable from real cohort codes and die on their own.
 *
 * ## The assertion that matters most
 *
 * EXIT DRILL asserts that cashing out to the registered address makes **zero**
 * calls to `/api/policy/requests`. That is the beta's headline claim, it is
 * enforced on chain (`unshield.rs` SpendPath::Ragequit), and it is exactly the
 * kind of thing that regresses silently — the withdrawal still succeeds through
 * the coordinator, so nothing looks broken. `BETA-STRATEGY.md` calls this the
 * assumption most likely to fail without anyone noticing. Hence the network-log
 * assertion rather than a "did it arrive" check.
 *
 * ## Requirements
 *
 *   agent-browser        npm i -g agent-browser && agent-browser install
 *   app running          NEXT_PUBLIC_DEV_SIGNER=1 RELAYER_KEYPAIR_PATH=… bun run dev
 *   ops/.env sourced     BACKEND_API_KEY + UTXOPIA_INVITE_ADMIN_KEY (both, see below)
 *   a funder keypair     devnet faucets are rate-limited; we transfer instead
 *
 * `signMessage` on the dev-signer adapter is load-bearing here. Without it
 * `useWallet().signMessage` is undefined, the redeem button stays disabled with
 * no error, and the whole journey is unreachable — which is why none of the
 * onboarding breakage this test now covers was ever caught by an automated run.
 */

import { execFileSync, execSync, spawnSync } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import bs58 from "bs58";
import * as btc from "@scure/btc-signer";
import { hex } from "@scure/base";

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const APP_URL = process.env.APP_URL ?? "http://localhost:3100";
const NETWORK = process.env.E2E_NETWORK ?? "devnet-regtest";
const VAULT = "verified";

/** Verified pool backend. Minting is deliberately not proxied through the web
 *  origin, so this talks to the backend directly. */
const BACKEND = process.env.BACKEND ?? "https://api-hybrid.utxopia.com/verified";
const RPC_URL = process.env.UTXOPIA_E2E_RPC_URL ?? process.env.TRITON_SOLANA_RPC_URL
  ?? "https://api.devnet.solana.com";

/** Pays to fund each run's throwaway wallet. The public devnet faucet is
 *  rate-limited into uselessness, so a transfer from a warm key is the only
 *  reliable path. */
const FUNDER_KEYPAIR_PATH = process.env.E2E_FUNDER_KEYPAIR
  ?? path.join(process.env.HOME ?? "", ".config/solana/id.json");
const FUND_SOL = Number(process.env.E2E_FUND_SOL ?? "0.3");

const DEPOSIT_AMOUNT = process.env.E2E_DEPOSIT_AMOUNT ?? "0.05";
const TRANSFER_AMOUNT = process.env.E2E_TRANSFER_AMOUNT ?? "0.02";
const WITHDRAW_AMOUNT = process.env.E2E_WITHDRAW_AMOUNT ?? "0.01";

/** Skip minting and use a code you already hold. */
const SUPPLIED_CODE = process.env.E2E_INVITE_CODE;

/** The restore leg wipes localStorage, so it runs last. Off by default: it
 *  proves recovery, not the money path, and it costs a slow re-scan. */
const RUN_RESTORE = process.env.E2E_RUN_RESTORE === "1";

/** Verified pool commitment tree, for the chain-side leaf count. */
const COMMITMENT_TREE = process.env.E2E_COMMITMENT_TREE ?? "yGNoFiir8rwDczTruh1iuLmBXVoQmoJdJ7Zo7CGj7Lt";

const DEV_WALLET_NAME = "UTXOpia Dev Signer";

// ---------------------------------------------------------------------------
// agent-browser helpers (same daemon-busy handling as token-loop.e2e.ts)
// ---------------------------------------------------------------------------

const DAEMON_BUSY = /Resource temporarily unavailable|daemon may be busy|os error 35/i;
const AB_ATTEMPTS = 4;

function ab(...args: string[]): string {
  for (let attempt = 1; ; attempt++) {
    const result = spawnSync("agent-browser", args, { encoding: "utf-8", stdio: ["pipe", "pipe", "pipe"] });
    if (result.status === 0) return result.stdout?.trim() ?? "";
    const message = (result.stderr?.trim() || result.stdout?.trim()) ?? "";
    if (attempt >= AB_ATTEMPTS || !DAEMON_BUSY.test(message)) {
      throw new Error(`agent-browser ${args.join(" ")} failed (exit ${result.status})\n${message}`);
    }
    console.log(`  … browser daemon busy, retrying (${attempt}/${AB_ATTEMPTS - 1})`);
    execSync(`sleep ${attempt * 5}`);
  }
}

/** Run JS in the page. Base64 so quoting never bites.
 *
 *  agent-browser JSON-encodes whatever the expression returned, so a string
 *  comes back *quoted and escaped*. Unwrapping here is not cosmetic: without it
 *  `JSON.parse(evalJs(...))` yields a string rather than an object, every field
 *  reads `undefined`, and the caller reports a confident, wrong diagnosis. */
function evalJs(script: string): string {
  const out = ab("eval", "-b", Buffer.from(script).toString("base64"));
  try {
    const once: unknown = JSON.parse(out);
    return typeof once === "string" ? once : out;
  } catch {
    return out;
  }
}

function evalJson<T>(script: string): T {
  return JSON.parse(evalJs(script)) as T;
}

function sleep(ms: number): void {
  execSync(`sleep ${(ms / 1000).toFixed(2)}`);
}

function pageText(): string {
  try {
    return evalJs("document.body.innerText.replace(/\\s+/g,' ')");
  } catch {
    return "<unreadable>";
  }
}

/** Poll for text in short slices — one long `wait` outlives the CLI's own IPC
 *  patience and reports a busy daemon as a missing element. */
function waitForText(needle: string, totalMs: number): void {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    if (pageText().includes(needle)) return;
    sleep(2000);
  }
  throw new Error(`timed out after ${totalMs}ms waiting for ${JSON.stringify(needle)}\npage showed: ${pageText().slice(0, 600)}`);
}

/** Leaves the backend has in the commitment tree for this pool. */
function indexedLeaves(): number {
  const raw = execFileSync("curl", [
    "-s", "-m", "20", `${APP_URL}/api/tree/status?network=${NETWORK}&vault=${VAULT}`,
  ], { encoding: "utf-8" });
  return (JSON.parse(raw) as { next_index?: number }).next_index ?? -1;
}

/** `next_index` on the on-chain commitment tree: u32 LE at byte 40. */
async function onChainLeaves(): Promise<number> {
  const account = await new Connection(RPC_URL, "confirmed").getAccountInfo(new PublicKey(COMMITMENT_TREE));
  if (!account) throw new Error(`commitment tree ${COMMITMENT_TREE} not found on ${RPC_URL}`);
  return account.data.readUInt32LE(40);
}

/**
 * Block until the indexer has actually caught up with the chain.
 *
 * Compare against the chain, never against an earlier reading of the backend.
 * `/api/tree/status` reports `"synced": true` whenever it is consistent with
 * *its own* epoch offset, so a backend rebuilding after a restart happily says
 * synced at 33 leaves while the chain is at 83 — and it can count *downwards*
 * on the way, which defeats any "did the number grow" check.
 *
 * Everything downstream depends on this. A proof built on a stale root fails
 * `inputMerkle[i].root === merkleRoot` and surfaces as
 * `Assert Failed. Error in template JoinSplit_322 line: 124`, which reads like
 * a circuit bug and is not one. Failing here instead names the real cause.
 */
async function waitForIndexerCaughtUp(totalMs = 300_000): Promise<void> {
  const deadline = Date.now() + totalMs;
  let chain = await onChainLeaves();
  let backend = indexedLeaves();
  if (backend >= chain) return;

  console.log(`  … indexer behind chain (${backend}/${chain}), waiting`);
  while (Date.now() < deadline) {
    sleep(10_000);
    chain = await onChainLeaves();
    backend = indexedLeaves();
    if (backend >= chain) {
      console.log(`  … indexer caught up (${backend}/${chain})`);
      return;
    }
  }
  throw new Error(
    `indexer never caught up (backend ${backend}, chain ${chain}). It reports synced=true regardless. ` +
    `Repair with ops/scripts/repair-indexer-leaves.ts before trusting any spend.`,
  );
}

/** How many nullifiers the backend has indexed for this pool. */
function indexedNullifiers(): number {
  const raw = execFileSync("curl", [
    "-s", "-m", "20", `${APP_URL}/api/nullifiers?network=${NETWORK}&vault=${VAULT}`,
  ], { encoding: "utf-8" });
  return (JSON.parse(raw) as { total?: number }).total ?? -1;
}

/**
 * Block until the backend has indexed the spend we just made.
 *
 * Spending is confirmed on chain long before the indexer serves the nullifier,
 * and until it does the client still believes the note it just spent is
 * available. The next spend then picks it and dies at simulation with
 * `custom program error: 0x1774` (6004 NullifierAlreadyUsed) — a real race a
 * member hits by doing exactly what the invite asks (deposit, transfer,
 * withdraw) in one sitting, not a test artefact. Waiting here keeps the run
 * honest about the *exit* rather than failing on the lag ahead of it.
 */
function waitForSpendIndexed(baseline: number, totalMs = 180_000): void {
  const deadline = Date.now() + totalMs;
  while (Date.now() < deadline) {
    const now = indexedNullifiers();
    if (now > baseline) {
      console.log(`  … spend indexed (nullifiers ${baseline} → ${now})`);
      return;
    }
    sleep(5000);
  }
  throw new Error(`backend never indexed the spend (nullifiers stuck at ${baseline} for ${totalMs}ms)`);
}

/**
 * Restart the browser daemon.
 *
 * `Resource temporarily unavailable (os error 35)` is the daemon dying under
 * the CPU load of in-browser proof generation, not a product failure. Retrying
 * the same command does not help — the daemon is gone — so the documented
 * recovery is a close, a pause, and one warm-up open. Running immediately after
 * `close` races the restart and fails on the first command instead.
 */
function recycleDaemon(): void {
  try { ab("close"); } catch { /* already dead, which is the case we are fixing */ }
  sleep(5000);
  ab("open", APP_URL);
  sleep(3000);
}

function screenshot(label: string): void {
  const dir = path.join(__dirname, "screenshots");
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `beta-${label}-${new Date().toISOString().replace(/[:.]/g, "-")}.png`);
  try { ab("screenshot", file); console.log(`  [screenshot] ${file}`); } catch { /* daemon wedged */ }
}

/** React ignores a bare `.value =`; go through the native setter and fire the
 *  event it listens for. agent-browser's own `fill` handles most fields, but
 *  not every controlled input in this app. */
function setInput(selector: string, value: string): void {
  evalJs(`(()=>{
    const el = document.querySelector(${JSON.stringify(selector)});
    if (!el) throw new Error("no element: " + ${JSON.stringify(selector)});
    const proto = el.tagName === 'TEXTAREA' ? window.HTMLTextAreaElement.prototype : window.HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, 'value').set.call(el, ${JSON.stringify(value)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`);
  sleep(500);
}

function clickByText(text: string): void {
  evalJs(`(()=>{
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.trim().startsWith(${JSON.stringify(text)}));
    if (!b) throw new Error("no button: " + ${JSON.stringify(text)});
    b.scrollIntoView({block:'center'}); b.click();
  })()`);
  sleep(1200);
}

function clickTestId(testid: string): void {
  evalJs(`(()=>{
    const el = document.querySelector('[data-testid=' + ${JSON.stringify(JSON.stringify(testid))} + ']');
    if (!el) throw new Error("no testid: " + ${JSON.stringify(testid)});
    el.scrollIntoView({block:'center'}); el.click();
  })()`);
  sleep(1200);
}

/** The review modals gate on a press-and-hold, so a click does nothing. */
function holdToConfirm(): void {
  const box = evalJson<{ x: number; y: number }>(`(()=>{
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.trim() === 'Hold to confirm');
    if (!b) throw new Error('no Hold to confirm button');
    const r = b.getBoundingClientRect();
    return JSON.stringify({ x: Math.round(r.x + r.width/2), y: Math.round(r.y + r.height/2) });
  })()`);
  ab("mouse", "move", String(box.x), String(box.y));
  ab("mouse", "down");
  sleep(4000);
  ab("mouse", "up");
}

/** Persist dev keys + pre-select the wallet, then navigate. `walletName` is
 *  what makes autoConnect restore the adapter; without it every form sits on
 *  "Connect wallet" and nothing mounts. */
function openWithKeys(url: string, devKeys: object): void {
  ab("open", APP_URL);
  evalJs(
    `localStorage.setItem("__UTXOPIA_DEV_KEYS", ${JSON.stringify(JSON.stringify(devKeys))});` +
    `localStorage.setItem("walletName", ${JSON.stringify(JSON.stringify(DEV_WALLET_NAME))});`,
  );
  ab("open", url);
  sleep(12000);
}

function appUrl(pathname: string): string {
  return `${APP_URL}${pathname}?network=${NETWORK}&vault=${VAULT}`;
}

// ---------------------------------------------------------------------------
// Off-browser setup
// ---------------------------------------------------------------------------

interface DevKeys {
  solanaSecretKeyB58: string;
  btcWif: string;
  utxopiaSeedHex: string;
}

/** A fresh identity per run. Reusing one would fail at REDEEM: a wallet gets
 *  one membership, forever. */
function freshKeys(): { keys: DevKeys; wallet: PublicKey } {
  const sol = Keypair.generate();
  const btcPriv = crypto.getRandomValues(new Uint8Array(32));
  return {
    keys: {
      solanaSecretKeyB58: bs58.encode(sol.secretKey),
      // A real WIF even though no BTC leg runs here. `installUnisatShim`
      // decodes it on mount, and a raw base58 key throws "Invalid checksum"
      // out of the DevSigner effect — which takes the whole page down, so
      // every step then fails as "This page couldn't load".
      btcWif: btc.WIF().encode(btcPriv),
      utxopiaSeedHex: hex.encode(crypto.getRandomValues(new Uint8Array(32))),
    },
    wallet: sol.publicKey,
  };
}

function mintCode(): string {
  if (SUPPLIED_CODE) {
    console.log("  using E2E_INVITE_CODE from the environment");
    return SUPPLIED_CODE.trim();
  }
  for (const name of ["UTXOPIA_INVITE_ADMIN_KEY", "BACKEND_API_KEY"]) {
    if (!process.env[name]) {
      throw new Error(`${name} is not set — the invite routes need BOTH keys, or every call 401s. Try: set -a && source ops/.env && set +a`);
    }
  }
  const expires = Math.floor(Date.now() / 1000) + 86_400;
  const raw = execFileSync("curl", [
    "-sfX", "POST", `${BACKEND}/api/invite/codes`,
    "-H", `x-invite-admin-key: ${process.env.UTXOPIA_INVITE_ADMIN_KEY}`,
    "-H", `X-API-Key: ${process.env.BACKEND_API_KEY}`,
    "-H", "content-type: application/json",
    "-d", JSON.stringify({ count: 1, label: "e2e-dryrun", expires_at: expires }),
  ], { encoding: "utf-8" });
  const code = (JSON.parse(raw) as { codes: string[] }).codes[0];
  if (!code) throw new Error(`mint returned no code: ${raw.slice(0, 200)}`);
  return code;
}

async function fundWallet(wallet: PublicKey): Promise<void> {
  const funder = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(FUNDER_KEYPAIR_PATH, "utf-8")) as number[]),
  );
  const connection = new Connection(RPC_URL, "confirmed");
  const balance = await connection.getBalance(funder.publicKey);
  const needed = FUND_SOL * LAMPORTS_PER_SOL;
  if (balance < needed) {
    throw new Error(`funder ${funder.publicKey.toBase58()} holds ${balance / LAMPORTS_PER_SOL} SOL, needs ${FUND_SOL}`);
  }
  const tx = new Transaction().add(SystemProgram.transfer({
    fromPubkey: funder.publicKey, toPubkey: wallet, lamports: needed,
  }));
  const sig = await sendAndConfirmTransaction(connection, tx, [funder], { commitment: "confirmed" });
  console.log(`  funded ${FUND_SOL} SOL — ${sig}`);
}

// ---------------------------------------------------------------------------
// Steps
// ---------------------------------------------------------------------------

function stepRedeem(devKeys: DevKeys, code: string, wallet: PublicKey): void {
  console.log("\n[REDEEM] the code, on /redeem");
  openWithKeys(`${APP_URL}/redeem?network=${NETWORK}`, devKeys);
  waitForText("Redeem your invite code", 30_000);

  setInput('input[placeholder="XXXXX-XXXXX-XXXXX-XXXXX"]', code);
  const state = evalJson<{ found: boolean; disabled: boolean }>(`(()=>{
    const b = Array.from(document.querySelectorAll('button')).find(x => x.innerText.trim() === 'Redeem invite code');
    return JSON.stringify({ found: !!b, disabled: b?.disabled });
  })()`);

  // A disabled button here almost always means signMessage is missing from the
  // wallet adapter, not that the code is bad — the form reports nothing either
  // way, so name the likely cause rather than timing out on the success text.
  if (!state.found || state.disabled) {
    throw new Error("the redeem button is disabled with a code filled in — check that the wallet adapter implements signMessage (lib/dev-signer/solana-adapter.ts)");
  }

  clickByText("Redeem invite code");
  waitForText("You're in.", 90_000);
  console.log(`  ✓ ${wallet.toBase58()} is a member`);
}

function stepDeposit(devKeys: DevKeys): void {
  console.log(`\n[DEPOSIT] ${DEPOSIT_AMOUNT} SOL into the Verified vault`);
  openWithKeys(appUrl("/vault/deposit"), devKeys);
  waitForText("Add funds", 30_000);

  clickTestId("token-selector-trigger");
  clickTestId("token-option-SOL");
  setInput('[data-testid="shield-amount"]', DEPOSIT_AMOUNT);

  // Guards the bug where switching vault left the recipient on the previous
  // vault's identity: funds land in the right pool encrypted to the wrong one
  // and are then invisible in both views.
  const submitLabel = evalJs(`document.querySelector('[data-testid=shield-submit]')?.innerText || ''`);
  if (!submitLabel.includes("Verified")) {
    throw new Error(`deposit is not scoped to the Verified vault (submit reads ${JSON.stringify(submitLabel)})`);
  }

  clickTestId("shield-submit");
  waitForText("Funds added privately", 120_000);
  console.log("  ✓ deposit confirmed");
}

function stepBalanceVisible(devKeys: DevKeys): void {
  console.log("\n[BALANCE] the deposit is actually visible to its owner");
  openWithKeys(appUrl("/vault"), devKeys);
  // Scanning + nullifier fetch settle a few seconds after mount.
  for (let attempt = 0; attempt < 20; attempt++) {
    if (/zkSOL[^0-9]*0\.0[1-9]/.test(pageText())) {
      console.log("  ✓ zkSOL balance rendered");
      return;
    }
    sleep(3000);
  }
  throw new Error(`deposit never appeared in the vault. On-chain success with an empty vault means the note was encrypted to another identity, or the spent-set was read for the wrong pool.\npage: ${pageText().slice(0, 500)}`);
}

function stepTransfer(devKeys: DevKeys, selfAddress: string): void {
  console.log(`\n[TRANSFER] ${TRANSFER_AMOUNT} zkSOL to self (exercises the change note)`);
  openWithKeys(appUrl("/send"), devKeys);
  waitForText("Send privately", 30_000);

  setInput('input[placeholder="Paste an address, @handle, or name.utxopia.sol"]', selfAddress);
  sleep(4000);
  clickTestId("token-source-trigger");
  clickTestId("token-source-zkSOL");
  setInput('input[placeholder="0"]', TRANSFER_AMOUNT);

  clickByText("Review private transfer");
  sleep(4000);
  holdToConfirm();
  waitForText("Payment sent", 180_000);
  console.log("  ✓ transfer sent");
}

/** The one the beta rests on. */
function stepExitDrill(devKeys: DevKeys, wallet: PublicKey): void {
  console.log(`\n[EXIT DRILL] cash out ${WITHDRAW_AMOUNT} SOL to the registered address`);
  openWithKeys(appUrl("/vault/withdraw"), devKeys);
  waitForText("Take funds out", 30_000);

  // Clear the log AFTER the page settles: mount-time traffic is not the
  // withdrawal's, and a stale policy call from an earlier leg would fail this
  // for the wrong reason.
  ab("network", "requests", "--clear");

  clickTestId("cash-out-destination-solana");
  clickTestId("token-source-trigger");
  clickTestId("token-source-zkSOL");
  setInput('input[placeholder="Paste a Solana wallet address"]', wallet.toBase58());
  setInput('input[placeholder="0"]', WITHDRAW_AMOUNT);

  clickByText("Review cash out");
  sleep(15_000); // note selection + proof setup before the modal opens
  holdToConfirm();
  waitForText("Payment sent", 240_000);

  const policyCalls = ab("network", "requests", "--filter", "policy");
  if (/\/api\/policy\/requests/.test(policyCalls)) {
    throw new Error(
      "cash-out to the REGISTERED address went through the coordinator.\n" +
      "The registry entry is supposed to be the authorisation (unshield.rs, SpendPath::Ragequit),\n" +
      "so this path must never call /api/policy/requests. Calls seen:\n" + policyCalls,
    );
  }
  console.log("  ✓ withdrew with zero coordinator calls");
}

function stepFeedback(): void {
  console.log("\n[FEEDBACK] the intake a member would actually use");
  evalJs(`document.querySelector('[aria-label="Send beta feedback"]').click()`);
  sleep(2500);

  setInput('[role=dialog] textarea', `beta-invite e2e run at ${new Date().toISOString()}`);
  setInput('[role=dialog] input[type=email]', "e2e@example.com");
  evalJs(`document.querySelector('[role=dialog] input[type=checkbox]').click()`);
  sleep(500);
  evalJs(`(()=>{
    const b = Array.from(document.querySelectorAll('[role=dialog] button')).find(x => x.innerText.trim() === 'Send feedback');
    if (!b) throw new Error('no Send feedback button');
    b.click();
  })()`);

  // A 503 here means no sink is configured — real, and worth failing on: the
  // form would silently swallow every report in production.
  waitForText("Got it — thank you.", 30_000);
  console.log("  ✓ feedback delivered, 1-on-1 opt-in recorded");
}

function stepRestore(devKeys: DevKeys): void {
  console.log("\n[RESTORE] wipe the profile, come back from the backup file alone");
  // Two proof-heavy legs just ran; the daemon is the most likely casualty and
  // it takes the download with it. Recycling closes the browser, which also
  // drops localStorage — so the identity has to be re-seeded before we can
  // download its backup. That does not weaken the test: the seed only gets us
  // back to a live session, and everything after the wipe below comes from the
  // file alone.
  recycleDaemon();
  const backupPath = path.join(__dirname, "screenshots", "..", `beta-backup-${Date.now()}.json`);

  openWithKeys(appUrl("/vault"), devKeys);
  sleep(8_000);
  clickByText("Set up your wallet");

  // Capture the blob the download handler builds instead of driving a real
  // download. `agent-browser download` wedges the daemon here every time
  // (os error 35, and recycling first does not help), and the file it would
  // write is exactly this string — so intercept `createObjectURL`, click, and
  // read the payload back through eval. Same bytes, no fragile command.
  evalJs(`(()=>{
    window.__backupJson = null;
    const original = URL.createObjectURL.bind(URL);
    URL.createObjectURL = (blob) => {
      blob.text().then((text) => { window.__backupJson = text; });
      return original(blob);
    };
  })()`);
  clickByText("Download backup");

  let payload = "";
  for (let attempt = 0; attempt < 20 && !payload; attempt++) {
    sleep(1000);
    payload = evalJs("window.__backupJson || ''");
  }
  if (!payload.trim().startsWith("{")) {
    throw new Error(`could not capture the backup payload (got ${JSON.stringify(payload.slice(0, 80))})`);
  }
  fs.writeFileSync(backupPath, payload, "utf-8");
  console.log(`  … captured backup (${payload.length} bytes)`);

  evalJs("localStorage.clear(); sessionStorage.clear();");
  ab("open", appUrl("/vault"));
  sleep(18_000);
  waitForText("Create private vault", 30_000);

  clickByText("Create private vault");
  sleep(3000);
  clickByText("Skip");
  sleep(2500);
  ab("upload", 'input[type=file]', backupPath);

  for (let attempt = 0; attempt < 20; attempt++) {
    if (/zkSOL[^0-9]*0\.0[1-9]/.test(pageText())) {
      console.log(`  ✓ balance restored from ${backupPath}`);
      fs.rmSync(backupPath, { force: true });
      return;
    }
    sleep(3000);
  }
  throw new Error(`restore did not bring the balance back.\npage: ${pageText().slice(0, 500)}`);
}

/** The receive address of the run's own verified identity, read off the page
 *  rather than re-derived — re-deriving needs the vault seed-scoping rules and
 *  would silently test a different identity if they ever change. */
function readSelfAddress(devKeys: DevKeys): string {
  openWithKeys(appUrl("/vault/deposit"), devKeys);
  waitForText("Add funds", 30_000);
  const address = evalJs(`(()=>{
    const m = document.documentElement.outerHTML.match(/utxo:[0-9a-f]{180,220}/);
    return m ? m[0] : '';
  })()`);
  if (!address.startsWith("utxo:")) {
    throw new Error("could not read this identity's receive address from the deposit page");
  }
  return address;
}

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  console.log("UTXOpia beta-invite E2E — the invited member's journey");
  console.log(`APP_URL ${APP_URL}   network ${NETWORK}   vault ${VAULT}`);
  console.log("NOTE: this run mints a code and burns a wallet. Both are permanent.\n");

  try {
    execSync("agent-browser --version", { stdio: "pipe" });
  } catch {
    console.error("ERROR: agent-browser not found.\n  npm i -g agent-browser && agent-browser install");
    process.exit(1);
  }

  // Before anything is spent. A stale indexer makes every proof downstream
  // fail on a root mismatch, and finding that out after minting costs a code
  // and a wallet that cannot be reused.
  console.log("[SETUP] checking the indexer against the chain");
  await waitForIndexerCaughtUp();

  const { keys, wallet } = freshKeys();
  console.log(`[SETUP] throwaway wallet ${wallet.toBase58()}`);

  const code = mintCode();
  // Printed because a failed run leaves it unredeemed and you may want to reuse
  // it via E2E_INVITE_CODE instead of minting another.
  console.log(`[SETUP] invite code ${code} (label e2e-dryrun, 1 day)`);

  await fundWallet(wallet);

  let redeemed = false;
  try {
    stepRedeem(keys, code, wallet);
    redeemed = true;
    stepDeposit(keys);
    await waitForIndexerCaughtUp();
    stepBalanceVisible(keys);
    const selfAddress = readSelfAddress(keys);
    const nullifiersBeforeTransfer = indexedNullifiers();
    stepTransfer(keys, selfAddress);
    // A spend needs two different things indexed, in two different tables, and
    // waiting for one is not waiting for the other:
    //   - the nullifier, or the next spend re-picks the note just spent (0x1774)
    //   - the new leaves, or the next spend cannot build a merkle path over its
    //     own change note ("Note … not found on-chain")
    waitForSpendIndexed(nullifiersBeforeTransfer);
    await waitForIndexerCaughtUp();
    stepExitDrill(keys, wallet);
    stepFeedback();
    if (RUN_RESTORE) stepRestore(keys);

    console.log("\n✓ PASSED — a member with a code can join, move funds, and exit unaided.");
  } catch (err) {
    console.error(`\n✗ FAILED: ${err instanceof Error ? err.message : String(err)}`);
    screenshot("failure");
    // Only worth suggesting while the code can still be spent. After REDEEM it
    // is bound to this run's wallet forever, and re-running with it would fail
    // on a confusing "already redeemed" rather than on whatever actually broke.
    if (!redeemed) console.error(`\nStill unredeemed — reuse it:  export E2E_INVITE_CODE=${code}`);
    else console.error(`\nCode ${code} is spent (wallet ${wallet.toBase58()}); a re-run mints a new one.`);
    process.exit(1);
  } finally {
    try { ab("close"); } catch { /* already gone */ }
  }
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
