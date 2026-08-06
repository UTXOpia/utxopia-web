# UTXOpia E2E Tests

Browser-driven end-to-end tests using [agent-browser](https://agent-browser.dev).

## Prerequisites

### 1. Install agent-browser

```bash
npm i -g agent-browser && agent-browser install
```

### 2. Environment variables

| Variable | Required | Description |
|---|---|---|
| `APP_URL` | No (default: `http://localhost:3000`) | Base URL of the running app |
| `NEXT_PUBLIC_DEV_SIGNER=1` | Yes (build-time) | Enables the dev-signer shim inside the app |
| `UTXOPIA_DEV_KEYS_JSON` | Yes* | JSON blob of dev keys (see below) |
| `E2E_TRANSFER_RECIPIENT` | Yes | Stealth meta address (`utxo:…`) for the transfer step |
| `E2E_SOL_UNSHIELD_ADDR` | Yes | Public Solana devnet address for the unshield step |

*Alternatively, create `e2e/.dev-keys.json` (see below). The file is gitignored.

### 3. Start the app with dev-signer enabled

```bash
cd web && NEXT_PUBLIC_DEV_SIGNER=1 bun run dev
```

The app will be available at `http://localhost:3000` by default.

## Dev Keys

The dev-signer reads throwaway test keypairs. Two sources are supported (in priority order):

### Option A — environment variable (CI-friendly)

```bash
export UTXOPIA_DEV_KEYS_JSON='{"solanaSecretKeyB58":"...","btcWif":"...","utxopiaSeedHex":"..."}'
```

### Option B — local file (developer machine)

Create `e2e/.dev-keys.json` (this path is gitignored):

```json
{
  "solanaSecretKeyB58": "...",

  "btcWif": "...",
  "utxopiaSeedHex": "..."
}
```

### Task-8 funding step

Run the dev-signer account generator to derive the three chain addresses:

```bash
bun ops/scripts/dev-signer-accounts.ts
```

The script prints a JSON blob containing the three key fields above and the
public addresses to fund. Fund them on the relevant testnet/devnet faucets
before running the E2E. Paste the output JSON into your chosen key source above.

Minimum suggested funding:
- Solana devnet: 0.05 SOL and ~0.01 zkBTC (or whatever token is registered)

## Running the token-loop E2E

```bash
# From the web directory
E2E_TRANSFER_RECIPIENT="utxo:..." \
E2E_SOL_UNSHIELD_ADDR="<solana-pubkey>" \
bun e2e/token-loop.e2e.ts
```

Or set everything in a `.env.e2e` file and source it:

```bash
source .env.e2e && bun e2e/token-loop.e2e.ts
```

The script exits 0 on success, non-zero on any step failure.
Screenshots on failure are written to `e2e/screenshots/`.

## What the test drives

On Solana devnet:

1. **SHIELD** — navigates to `/vault/deposit`, fills amount, submits, waits for "Funds added privately".
2. **TRANSFER** — navigates to `/send`, enters a stealth address + amount, submits, waits for "Sent privately".
3. **UNSHIELD** — navigates to `/vault/withdraw`, enters a public address + amount, submits, waits for the success indicator.

### Key injection — localStorage model

Before each step the script performs a three-phase injection:

1. **Open `APP_URL`** — navigates to the app root to establish the correct origin (required for `localStorage` access).
2. **`eval` → `localStorage.setItem(...)`** — persists two keys that survive the subsequent navigation:
   - `__UTXOPIA_DEV_KEYS` (`DEV_KEYS_STORAGE_KEY`) — the JSON-encoded dev keys.
   - `walletName` — set to `"UTXOpia Dev Signer"`. **Required.** `<WalletProvider autoConnect>` only restores a *previously selected* wallet, so without this the Solana legs stall on "Connect wallet": the amount field and submit button never mount and every token step fails.
3. **Open the target URL** (e.g. `/vault/deposit?network=devnet-regtest`) — on this load the `DevSigner` component mounts, `loadDevKeys()` reads the persisted value from `localStorage`, and the BTC (`window.unisat`) shim is installed. The Solana side is not a `window` shim: it is registered as a wallet-adapter entry via `devSolanaAdapters()` in `app/providers.tsx`, which is why the `walletName` seed is what actually connects it.

This is more robust than injecting into `window.__UTXOPIA_DEV_KEYS` directly: `window` globals are reset on every navigation, so a window injection before a `?network=` reload can race the `DevSigner` useEffect. `localStorage` persists across same-origin navigations and is the second priority source in `loadDevKeys()` (after `globalThis` injection, before env vars).

## BTC legs (RUN_BTC=1)

BTC deposit and BTC redeem (cash-out to Bitcoin) steps are included in
`token-loop.e2e.ts` but are **disabled by default**. Set `RUN_BTC=1` to
enable them. They run after the token loop.

### Required infrastructure

The BTC legs require the **full backend stack** to be running:

| Service | Purpose |
|---|---|
| Bitcoin regtest node (Docker) | Produces blocks so BTC transactions confirm |
| Esplora | BTC tx indexer; the dev `window.unisat` shim broadcasts PSBTs here |
| deposit-tracker | Detects BTC deposits, waits for confirmations, registers with backend |
| BTC light client (on Solana) | Verifies SPV inclusion proofs for BTC deposits |
| Redemption service | Processes unshield-to-BTC (redeem) requests |
| Ika MPC | Co-signs the BTC payout transaction with the dWallet |

Before running with `RUN_BTC=1`, verify that all of these services are up:

```bash
bun ops/scripts/check-devnet-regtest-infra.ts
```

If the script reports any service as red (down), the BTC legs will time out.
Skip them by not setting `RUN_BTC=1`.

### Extra environment variables

| Variable | Default | Description |
|---|---|---|
| `RUN_BTC` | unset | Set to `1` to enable BTC legs |
| `E2E_BTC_REDEEM_ADDR` | (required when RUN_BTC=1) | Testnet/regtest bech32 BTC address to receive redeem payout |
| `E2E_BTC_DEPOSIT_AMOUNT_SATS` | `10000` | Amount to deposit, in **sats** (the field is `Amount (sats)`) |
| `E2E_BTC_REDEEM_AMOUNT` | `5000` | Amount to redeem in sats |
| `BTC_DEPOSIT_TIMEOUT_MS` | `600000` (10 min) | Polling timeout for zkBTC note to appear after deposit |
| `BTC_REDEEM_TIMEOUT_MS` | `600000` (10 min) | Polling timeout for BTC txid/Confirmed to appear after redeem |

### Running with BTC legs

```bash
RUN_BTC=1 \
E2E_TRANSFER_RECIPIENT="utxo:..." \
E2E_SOL_UNSHIELD_ADDR="<solana-pubkey>" \
E2E_BTC_REDEEM_ADDR="bcrt1q..." \
bun e2e/token-loop.e2e.ts
```

### How BTC legs work

**BTC deposit (`stepBtcDeposit`)**

1. Navigates to `/vault/deposit?network=<chain>`.
2. Selects the BTC token and fills `Amount (sats)`. What happens next depends
   on the network: on **devnet-regtest** the branch renders the regtest faucet
   ("Get private test BTC"), which credits the private vault directly — there
   is no PSBT preview. On the **testnet4 wallet flow** it clicks
   "Add BTC privately", waits for the PSBT preview, then "Confirm & Sign",
   and the `window.unisat` dev shim auto-signs and broadcasts via Esplora.
   The script tries the faucet button first and falls back to the PSBT path.
3. Polls `/vault/activity` until a "Received" note (zkBTC) appears, meaning
   the deposit-tracker has fully confirmed + minted the note on-chain.
   Timeout: `BTC_DEPOSIT_TIMEOUT_MS` (default 10 min).

**BTC redeem (`stepBtcRedeem`)**

1. Navigates to `/vault/withdraw?network=<chain>`.
2. Selects the **Bitcoin** destination tab, then fills the `Bitcoin address`
   field with `E2E_BTC_REDEEM_ADDR`. Note: on regtest the app pins the payout
   to the connected test wallet and pre-fills this field ("Regtest safety: BTC
   withdrawals can only go to your connected test wallet"), so
   `E2E_BTC_REDEEM_ADDR` is ignored there.
3. Fills the amount, clicks "Review BTC withdrawal", holds the "Hold to
   confirm" button in the ReviewModal.
4. Waits for the app to redirect to `/vault/activity?result=cashout_btc`.
5. Polls the vault page for the `WithdrawalStatusList` to show "Confirmed"
   or a "BTC TX" row (indicating the BTC txid from Ika MPC is present).
   Timeout: `BTC_REDEEM_TIMEOUT_MS` (default 10 min).

### Coupling hazard

Rebuilding the Docker regtest chain (or wiping the devnet state) will orphan
the on-chain light client and deposit state. If you do this, follow the
recovery steps in `memory/hybrid-regtest-devnet-coupling.md` before rerunning.

## Selector notes

Selectors were validated against a live dev server (agent-browser 0.27.0). What
that run established, and which is worth knowing before editing them:

- **`find role textbox` does not resolve** in this app — match inputs by their
  `<label>` instead (`find label "Recipient"`, `find label "Amount"`).
- **Multi-line button labels are not matchable by accessible name.** The token
  selector and the cash-out destination tabs render their label and description
  as separate lines, so their accessible names contain newlines
  (`"Solana\nCash out"`) and `--name "Solana Cash out"` fails. Both carry
  `data-testid`s for this reason: `token-selector-trigger`,
  `token-option-<SYMBOL>`, `cash-out-destination-{bitcoin,solana}`.
- **Submit buttons are not called "Send".** They are `Add <SYMBOL> privately`,
  `Review private transfer`, `Review cash out` and `Review BTC withdrawal`.
  Matching `--name "Send"` is actively dangerous on `/send`: it also matches
  **"Send via claim link"**, a different flow.
- **Amount placeholders differ per page** — `0.00` on deposit, but the send and
  withdraw fields use `0`, which is why they are matched by label.

Steps still annotated `// UNVERIFIED` need a funded private balance or the full
backend stack: the review modal only opens with a non-zero balance, so the
confirm/hold controls and the success strings could not be exercised.

To re-check after a UI change:

```bash
agent-browser open http://localhost:3000/vault/deposit?network=devnet-regtest
agent-browser snapshot -i
```
