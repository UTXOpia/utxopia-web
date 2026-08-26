import type { RecipientType } from "./recipient-detect";
import type { SpendDoc } from "@utxopia/sdk";

export type SendIntentKind = "redeem" | "transact" | "unshield" | "claim_link";

export interface SendIntent {
  kind: SendIntentKind;
  recipientType: RecipientType | "claim_link";
  recipientValue: string;
  sourceToken: string;
  amount: string;
}

export interface BuildSendIntentInput {
  recipientType: RecipientType | "claim_link";
  recipientValue: string;
  sourceToken: string;
  amount: string;
}

const BPS_DENOMINATOR = 10_000n;

export function computeBtcServiceFee(
  amountBaseUnits: bigint,
  serviceFeeBase: number,
  serviceFeeBps: number,
): bigint {
  if (amountBaseUnits <= 0n) return 0n;
  const base = BigInt(Math.max(0, Math.floor(serviceFeeBase)));
  const bps = BigInt(Math.max(0, Math.floor(serviceFeeBps)));
  return (amountBaseUnits * bps) / BPS_DENOMINATOR + base;
}

/**
 * Pure dispatch: maps wizard state → which on-chain ix kind to build.
 * Caller threads the resulting `kind` to the right SDK builder.
 *
 * Validation is intentionally minimal — only the cross-field constraints
 * the wizard's own UI doesn't already enforce visually.
 */
export function buildSendIntent(input: BuildSendIntentInput): SendIntent {
  const { recipientType, sourceToken } = input;

  if (recipientType === "btc" && sourceToken !== "zkBTC") {
    throw new Error(
      "Bitcoin recipients can only receive zkBTC — pick zkBTC as the source token.",
    );
  }

  let kind: SendIntentKind;
  switch (recipientType) {
    case "btc":
      kind = "redeem";
      break;
    case "stealth_sns":
    case "stealth_meta":
      kind = "transact";
      break;
    case "spl_wallet":
      kind = "unshield";
      break;
    case "claim_link":
      kind = "claim_link";
      break;
  }

  return {
    kind,
    recipientType,
    recipientValue: input.recipientValue,
    sourceToken,
    amount: input.amount,
  };
}


export interface BuildSpendDocInput {
  recipientType: RecipientType;
  /** The destination exactly as typed. */
  recipient: string;
  network: string;
  asset: string;
  decimals: number;
  amountBaseUnits: bigint;
  relayerFee: bigint;
  /** Sum of the notes this spend will consume. */
  selectedTotal: bigint;
  /** Resolved destination bytes: scriptPubKey for BTC, owner pubkey for a wallet. */
  recipientBytes?: Uint8Array;
}

/**
 * The statement the user approves in the review modal.
 *
 * Returns null when the form cannot yet describe a spend truthfully — an
 * unresolved destination or notes that do not cover the amount. A doc is either
 * complete or absent; a half-filled one would be a caption, and the whole point
 * is that this is not a caption.
 */
export function buildSpendDoc(input: BuildSpendDocInput): SpendDoc | null {
  const mode: SpendDoc["mode"] =
    input.recipientType === "btc" ? "redeem"
    : input.recipientType === "spl_wallet" ? "unshield"
    : "transfer";
  if (input.amountBaseUnits <= 0n) return null;
  if (mode !== "transfer" && !input.recipientBytes) return null;
  const change = input.selectedTotal - input.amountBaseUnits - input.relayerFee;
  if (change < 0n) return null;
  return {
    mode,
    network: input.network,
    asset: input.asset,
    decimals: input.decimals,
    recipient: input.recipient,
    recipientBytes: input.recipientBytes,
    amount: input.amountBaseUnits,
    relayerFee: input.relayerFee,
    change,
  };
}
