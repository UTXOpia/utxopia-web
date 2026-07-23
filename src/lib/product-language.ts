export interface ProductFeature {
  route: string;
  name: string;
  purpose: string;
}

export interface ProductTerm {
  term: string;
  meaning: string;
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
    name: "Private vault",
    purpose: "Review private balances and choose whether to deposit, send, cash out, or view activity.",
  },
  {
    route: "/vault/deposit",
    name: "Deposit and shield",
    purpose: "Deposit BTC into private zkBTC, or shield supported Solana assets from a connected wallet.",
  },
  {
    route: "/send",
    name: "Private send",
    purpose: "Send a private asset to a UTXOpia name, private receive address, or claim link.",
  },
  {
    route: "/vault/withdraw",
    name: "Cash out and withdraw",
    purpose: "Cash out supported assets to a Solana wallet, or withdraw zkBTC to a native Bitcoin address.",
  },
  {
    route: "/vault/activity",
    name: "Activity",
    purpose: "Review deposits, private transfers, cash-outs, withdrawals, fees, and personal labels or notes.",
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
    purpose: "Request supported test assets. BTC goes directly to the private vault; supported tokens use the deposit flow.",
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
    term: "Private vault",
    meaning: "The UTXOpia account that holds private notes and balances. It is not a native Bitcoin or Solana wallet.",
  },
  {
    term: "Connected wallet",
    meaning: "An external Solana wallet used to sign in, shield assets, or receive a cash-out.",
  },
  {
    term: "Public balance",
    meaning: "Assets held directly in a connected wallet and visible on the underlying chain.",
  },
  {
    term: "Private balance",
    meaning: "The total value of available private notes found by the vault viewing key.",
  },
  {
    term: "Private receive address",
    meaning: "A reusable utxo: meta-address that lets senders create a fresh private note for the recipient.",
  },
  {
    term: "Shield",
    meaning: "Move SOL, USDC, USDT, or another supported wallet asset into the private vault.",
  },
  {
    term: "BTC deposit",
    meaning: "Send native BTC through the deposit flow, then wait for Bitcoin confirmation and the private-vault credit.",
  },
  {
    term: "Private transfer",
    meaning: "Send a private asset from one UTXOpia vault to another without exposing the transferred amount publicly.",
  },
  {
    term: "Cash out",
    meaning: "Move a supported private asset from the vault to a public Solana wallet destination.",
  },
  {
    term: "Withdraw BTC",
    meaning: "Redeem private zkBTC to a native Bitcoin address.",
  },
  {
    term: "Private note",
    meaning: "A spendable private output. A balance may contain several notes.",
  },
  {
    term: "Commitment",
    meaning: "The public encrypted fingerprint of a private note stored in the on-chain commitment tree.",
  },
  {
    term: "Nullifier",
    meaning: "A public marker created when a private note is spent. It prevents the same note from being spent twice.",
  },
  {
    term: "Relayer",
    meaning: "The service that submits a prepared proof to Solana. It cannot change the proof or spend vault funds.",
  },
  {
    term: "Activity",
    meaning: "The vault’s private transaction history reconstructed in the browser from chain data and local records.",
  },
];
