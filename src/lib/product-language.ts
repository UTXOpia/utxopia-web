export interface ProductFeature {
  route: string;
  name: string;
  purpose: string;
}

export interface ProductTerm {
  term: string;
  meaning: string;
}

/**
 * Canonical user-facing vocabulary.
 *
 * Actions describe what a person can do. Transaction types describe the
 * resulting record in Activity and Explorer. Protocol-only words such as
 * "unshield" and "redeem" must not replace these labels in primary UI.
 */
export const PRODUCT_COPY = {
  actions: {
    addFunds: "Add funds",
    sendPrivately: "Send privately",
    takeFundsOut: "Take funds out",
    reviewActivity: "Review activity",
  },
  transactions: {
    btcDeposit: "BTC deposit",
    shield: "Shield",
    privateTransfer: "Private transfer",
    cashOut: "Cash out",
    withdrawBtc: "Withdraw BTC",
  },
  locations: {
    privateVault: "Private vault",
    connectedWallet: "Connected wallet",
    publicBalance: "Public balance",
    privateBalance: "Private balance",
    privateReceiveAddress: "Private receive address",
  },
  protocol: {
    privateNote: "Private note",
    commitment: "Commitment",
    nullifier: "Nullifier",
    relayer: "Relayer",
    relayerFee: "Relayer fee",
  },
} as const;

export type ProductTransactionKind =
  | "shield"
  | "transfer"
  | "unshield"
  | "withdraw";

export function getProductTransactionLabel(
  kind: ProductTransactionKind,
  options: { isBtcDeposit?: boolean } = {},
): string {
  if (kind === "shield") {
    return options.isBtcDeposit
      ? PRODUCT_COPY.transactions.btcDeposit
      : PRODUCT_COPY.transactions.shield;
  }
  if (kind === "transfer") return PRODUCT_COPY.transactions.privateTransfer;
  if (kind === "unshield") return PRODUCT_COPY.transactions.cashOut;
  return PRODUCT_COPY.transactions.withdrawBtc;
}

/** User-facing feature map. Keep this aligned with the routes shipped in src/app. */
export const PRODUCT_FEATURES: ProductFeature[] = [
  {
    route: "/",
    name: "Overview",
    purpose: "See the active test network and enter the main private-vault workflows.",
  },
  {
    route: "/vault",
    name: PRODUCT_COPY.locations.privateVault,
    purpose: "Review private balances, add funds, send privately, take funds out, or review activity.",
  },
  {
    route: "/vault/deposit",
    name: PRODUCT_COPY.actions.addFunds,
    purpose: "Deposit BTC into private zkBTC, or shield supported Solana assets from a connected wallet.",
  },
  {
    route: "/send",
    name: PRODUCT_COPY.actions.sendPrivately,
    purpose: "Send a private asset to a UTXOpia name, private receive address, or claim link.",
  },
  {
    route: "/vault/withdraw",
    name: PRODUCT_COPY.actions.takeFundsOut,
    purpose: "Cash out supported assets to a Solana wallet, or withdraw zkBTC to a native Bitcoin address.",
  },
  {
    route: "/vault/activity",
    name: "Activity",
    purpose: "Review BTC deposits, shields, private transfers, cash outs, BTC withdrawals, fees, and personal labels or notes.",
  },
  {
    route: "/vault/received",
    name: "Received notes",
    purpose: "Inspect private notes found by the viewing key and see whether each note is available or spent.",
  },
  {
    route: "/claim",
    name: "Claim link",
    purpose: "Receive a private payment from a claim link and move it into the signed-in private vault.",
  },
  {
    route: "/faucet",
    name: "Test faucet",
    purpose: "Request supported test assets. BTC goes directly to the private vault; supported tokens use the shield flow.",
  },
  {
    route: "/explorer",
    name: "Explorer",
    purpose: "Inspect public protocol transactions, commitments, withdrawals, and Bitcoin transaction links.",
  },
  {
    route: "/settings",
    name: "Settings and private name",
    purpose: "Choose a network, manage a UTXOpia name, review access, and configure disclosure preferences.",
  },
  {
    route: "/compliance",
    name: "Disclosure status",
    purpose: "Review which privacy and audit capabilities are available for the active network and account.",
  },
  {
    route: "/audit",
    name: "Audit access",
    purpose: "Open delegated, read-only transaction access without granting permission to spend.",
  },
  {
    route: "/audit/issued",
    name: "Issued audit access",
    purpose: "Review the read-only audit access records created from this browser.",
  },
  {
    route: "/auditor",
    name: "Auditor workspace",
    purpose: "Inspect authorized private activity with delegated viewing data.",
  },
  {
    route: "/prove",
    name: "Verify BTC deposit",
    purpose: "Submit Bitcoin block-header and Merkle-proof data to verify a BTC deposit against the light client.",
  },
  {
    route: "/verify-proof",
    name: "Verify proof",
    purpose: "Check a selective-disclosure proof and read the statement it confirms.",
  },
];

/** Preferred product terms. Technical synonyms belong in protocol details, not primary actions. */
export const PRODUCT_TERMS: ProductTerm[] = [
  {
    term: PRODUCT_COPY.locations.privateVault,
    meaning: "The UTXOpia account that holds private notes and balances. It is not a native Bitcoin or Solana wallet.",
  },
  {
    term: PRODUCT_COPY.locations.connectedWallet,
    meaning: "An external Bitcoin or Solana wallet used to sign in, add funds, or receive funds from a cash out.",
  },
  {
    term: PRODUCT_COPY.locations.publicBalance,
    meaning: "Assets held directly in a connected wallet and visible on the underlying chain.",
  },
  {
    term: PRODUCT_COPY.locations.privateBalance,
    meaning: "The total value of available private notes found by the vault viewing key.",
  },
  {
    term: PRODUCT_COPY.locations.privateReceiveAddress,
    meaning: "A reusable utxo: meta-address that lets senders create a fresh private note for the recipient.",
  },
  {
    term: PRODUCT_COPY.transactions.shield,
    meaning: "Move SOL, USDC, USDT, or another supported wallet asset into the private vault.",
  },
  {
    term: PRODUCT_COPY.transactions.btcDeposit,
    meaning: "Send native BTC through the deposit flow, then wait for Bitcoin confirmation and the private-vault credit.",
  },
  {
    term: PRODUCT_COPY.transactions.privateTransfer,
    meaning: "Send a private asset from one UTXOpia vault to another without exposing the transferred amount publicly.",
  },
  {
    term: PRODUCT_COPY.transactions.cashOut,
    meaning: "Move a supported private asset from the vault to a public Solana wallet destination.",
  },
  {
    term: PRODUCT_COPY.transactions.withdrawBtc,
    meaning: "Redeem private zkBTC to a native Bitcoin address.",
  },
  {
    term: "Open pool",
    meaning: "The permissionless privacy pool. Anyone can deposit and spend — no invite, no approval.",
  },
  {
    term: "Verified pool",
    meaning: "The permissioned privacy pool. Entry is invite-only and every wallet must be on the operator's allowlist. It is a separate pool: funds never move between Open and Verified, and each keeps its own anonymity set.",
  },
  {
    term: PRODUCT_COPY.protocol.privateNote,
    meaning: "A spendable private output. A balance may contain several notes.",
  },
  {
    term: PRODUCT_COPY.protocol.commitment,
    meaning: "The public encrypted fingerprint of a private note stored in the on-chain commitment tree.",
  },
  {
    term: PRODUCT_COPY.protocol.nullifier,
    meaning: "A public marker created when a private note is spent. It prevents the same note from being spent twice.",
  },
  {
    term: PRODUCT_COPY.protocol.relayer,
    meaning: "The service that submits a prepared proof to Solana. It cannot change the proof or spend vault funds.",
  },
  {
    term: "Activity",
    meaning: "The vault’s private transaction history reconstructed in the browser from chain data and local records.",
  },
  {
    term: PRODUCT_COPY.protocol.relayerFee,
    meaning: "The amount paid to the relayer that submits a prepared private transaction to Solana.",
  },
];
