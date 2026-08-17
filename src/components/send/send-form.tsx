"use client";

import { useReducer, useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useWallet } from "@solana/wallet-adapter-react";
import { PublicKey } from "@solana/web3.js";
import { Bitcoin, Check, Link as LinkIcon, Loader2, LockKeyhole, Send, Wallet } from "lucide-react";
import { cn } from "@/lib/utils";
import { type RecipientType } from "./recipient-detect";
import { useRecipientResolution } from "@/hooks/use-recipient-resolution";
import { buildSendIntent, computeBtcServiceFee } from "./build-tx";
import { RecipientInput } from "./recipient-input";
import { SolanaAddressField } from "@/components/ui/solana-address-field";
import { TokenSourcePicker } from "./token-source-picker";
import { AmountField } from "./amount-field";
import { FeeSummary } from "./fee-summary";
import { ReviewModal } from "./review-modal";
import { ClaimLinkModal, type ClaimLinkResult } from "./claim-link-modal";
import { useUTXOpia } from "@/hooks/use-utxopia";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { useTokenPrices } from "@/hooks/use-token-prices";
import { useNoteAutoSelector } from "@/hooks/use-note-auto-selector";
import { useJoinSplitSubmit } from "@/hooks/use-joinsplit-submit";
import { estimateJoinSplitDimensions } from "@/lib/prover/join-split-dimensions";
import { useElapsedSeconds } from "@/hooks/use-elapsed-seconds";
import { useSnsName } from "@/hooks/use-sns-name";
import { useRelayerConfig, resolveRelayerFee } from "@/hooks/use-relayer-config";
import { buildTransferParams } from "@/hooks/use-build-transfer-params";
import { autoSelectNotes } from "@/components/send/_lifted/helpers";
import { PAY_TOKENS } from "@/lib/supported-tokens";
import { validateBtcAddress } from "@/components/ui/btc-address-input";
import { humanizeSpendError } from "@/lib/indexer-lag-error";
import { parseDecimalToBaseUnits } from "@/lib/utils/validation";
import { formatAmount } from "@/lib/utils/formatting";
import { useChainEnvironment } from "@/lib/chain-environment";
import { getVaultPrivacyDomain } from "@/lib/vault-config";
import { getChainAdapter } from "@/lib/chain-registry";
import { hrefWithChain } from "@/lib/network-config";
import { getSolanaExplorerTxUrl } from "@/lib/solana-network";
import { normalizePrivateNameHandle } from "@/lib/names/private-name-claim";
import { recordSubmittedTransaction, type SubmittedTransactionKind } from "@/lib/transaction-activity";
import { usePoolFees } from "@/hooks/use-pool-fees";
import { computeBpsFee, feeShareBps } from "@/lib/pool-fees";
import { PRODUCT_COPY } from "@/lib/product-language";
import {
  decodeStealthMetaAddress,
  deriveMasterKey,
  deriveKeysFromSeedCircuit,
  createStealthMetaAddress,
  isAuditorDisclosable,
  SOLANA_BOUND_CHAIN_ID,
  type SnsStealthAddress,
  type StealthMetaAddress,
} from "@utxopia/sdk";

type Action =
  | { type: "set_recipient"; value: string }
  | { type: "set_destination"; value: CashOutDestination }
  | { type: "set_token"; value: string }
  | { type: "set_amount"; value: string }
  | { type: "open_review" }
  | { type: "close_review" }
  | { type: "reset" };

type State = {
  recipient: string;
  cashOutDestination: CashOutDestination;
  sourceToken: string;
  amount: string;
  reviewOpen: boolean;
};

type CashOutDestination = "bitcoin" | "solana";
type SendFormMode = "send" | "cashout";

const initial: State = {
  recipient: "",
  cashOutDestination: "bitcoin",
  sourceToken: "zkBTC",
  amount: "",
  reviewOpen: false,
};

function reducer(state: State, action: Action): State {
  switch (action.type) {
    case "set_recipient":
      return { ...state, recipient: action.value };
    case "set_destination":
      return {
        ...state,
        cashOutDestination: action.value,
        recipient: "",
        sourceToken: "zkBTC",
        amount: "",
        reviewOpen: false,
      };
    case "set_token":
      return { ...state, sourceToken: action.value };
    case "set_amount":
      return { ...state, amount: action.value };
    case "open_review":
      return { ...state, reviewOpen: true };
    case "close_review":
      return { ...state, reviewOpen: false };
    case "reset":
      return initial;
  }
}

function CashOutDestinationPicker({
  value,
  onChange,
}: {
  value: CashOutDestination;
  onChange: (value: CashOutDestination) => void;
}) {
  const options = [
    {
      value: "bitcoin" as const,
      label: "Bitcoin",
      description: PRODUCT_COPY.transactions.withdrawBtc,
      icon: Bitcoin,
      selectedClass: "border-btc/50 bg-btc/10 text-btc",
    },
    {
      value: "solana" as const,
      label: "Solana",
      description: PRODUCT_COPY.transactions.cashOut,
      icon: Wallet,
      selectedClass: "border-purple/50 bg-purple/10 text-purple",
    },
  ];

  return (
    <fieldset className="space-y-1.5">
      <legend className="text-xs text-muted-foreground">Destination network</legend>
      <div className="grid grid-cols-2 gap-2">
        {options.map((option) => {
          const Icon = option.icon;
          const selected = option.value === value;
          return (
            <button
              key={option.value}
              type="button"
              data-testid={`cash-out-destination-${option.value}`}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                "relative flex min-h-14 items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-privacy/40",
                selected
                  ? option.selectedClass
                  : "border-gray/15 bg-muted/25 text-foreground hover:border-gray/30 hover:bg-muted/40",
              )}
            >
              <Icon className="h-4 w-4 shrink-0" />
              <span className="min-w-0">
                <span className="block text-sm font-medium">{option.label}</span>
                <span className={cn("block text-[11px]", selected ? "opacity-75" : "text-muted-foreground")}>
                  {option.description}
                </span>
              </span>
              {selected && <Check className="ml-auto h-3.5 w-3.5 shrink-0" />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

function generateClaimSecret(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Render a 32-byte Solana pubkey as `abc…xyz` for compact UI display.
 *  Uses base58 via @solana/web3.js's PublicKey since the project already
 *  pulls that dep — avoids a separate `bs58` import. */
function bs58Truncated(bytes: Uint8Array): string {
  // Lazy require so the dep isn't pulled into the bundle if this code path
  // never executes for a given user session.
  try {
    /* eslint-disable @typescript-eslint/no-require-imports */
    const { PublicKey } = require("@solana/web3.js") as typeof import("@solana/web3.js");
    /* eslint-enable @typescript-eslint/no-require-imports */
    const b58 = new PublicKey(bytes).toBase58();
    return b58.length > 16 ? `${b58.slice(0, 6)}…${b58.slice(-6)}` : b58;
  } catch {
    // Fall back to hex if PublicKey balks for some reason.
    return Array.from(bytes.slice(0, 4), (b) => b.toString(16).padStart(2, "0"))
      .join("") +
      "…" +
      Array.from(bytes.slice(-4), (b) => b.toString(16).padStart(2, "0")).join("");
  }
}

function RecipientOutcome({ type, chainLabel }: { type: RecipientType; chainLabel: string }) {
  const config = {
    btc: {
      icon: Bitcoin,
      title: PRODUCT_COPY.transactions.withdrawBtc,
      description: "The Bitcoin destination address will be visible on-chain.",
      tone: "text-btc border-btc/20 bg-btc/8",
    },
    stealth_sns: {
      icon: LockKeyhole,
      title: PRODUCT_COPY.transactions.privateTransfer,
      description: "The recipient gets a private note. Amount and recipient stay hidden.",
      tone: "text-privacy border-privacy/20 bg-privacy/8",
    },
    stealth_meta: {
      icon: LockKeyhole,
      title: PRODUCT_COPY.transactions.privateTransfer,
      description: "The recipient gets a private note. Amount and recipient stay hidden.",
      tone: "text-privacy border-privacy/20 bg-privacy/8",
    },
    spl_wallet: {
      icon: Wallet,
      title: `${PRODUCT_COPY.transactions.cashOut} to ${chainLabel}`,
      description: "Funds leave the private vault and arrive at a public wallet address.",
      tone: "text-purple border-purple/20 bg-purple/8",
    },
  } satisfies Record<RecipientType, {
    icon: typeof Bitcoin;
    title: string;
    description: string;
    tone: string;
  }>;

  const item = config[type];
  const Icon = item.icon;
  return (
    <div className={cn("flex items-start gap-2 rounded-lg border px-3 py-2 text-xs", item.tone)}>
      <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0" />
      <div>
        <p className="font-semibold">{item.title}</p>
        <p className="mt-0.5 text-gray/70">{item.description}</p>
      </div>
    </div>
  );
}

export function SendForm({
  mode = "send",
  showClaimLink = mode === "send",
}: {
  mode?: SendFormMode;
  showClaimLink?: boolean;
} = {}) {
  const [state, dispatch] = useReducer(reducer, initial);
  const [linkOpen, setLinkOpen] = useState(false);
  // The claim link picks its own asset: it has no recipient, so the form's
  // token (which a BTC address can force to zkBTC) doesn't apply to it.
  const [linkToken, setLinkToken] = useState("zkBTC");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [regtestBtcAddress, setRegtestBtcAddress] = useState<string | null>(null);
  const [regtestAddressError, setRegtestAddressError] = useState<string | null>(null);

  const ctx = useUTXOpia();
  const { lookupSnsName } = useSnsName();
  const submitter = useJoinSplitSubmit();
  const provingElapsed = useElapsedSeconds(submitter.status === "processing");
  const { publicKey } = useWallet();
  const router = useRouter();
  const tokenPrices = useTokenPrices();
  const chainEnv = useChainEnvironment();
  const poolFees = usePoolFees();
  const activeChainId = getChainAdapter(chainEnv.config).id;
  const boundChainId = SOLANA_BOUND_CHAIN_ID;
  const privacyDomain = getVaultPrivacyDomain(chainEnv.vaultId);
  const activeChainLabel = "Solana";
  const hasVaultKeys = ctx.hasKeys;
  const refreshPrivateBalance = ctx.refreshInbox;
  const balanceLoadKey = `${chainEnv.networkId}:${ctx.stealthAddressEncoded ?? "locked"}`;
  const balanceLoadRequested = useRef<string | null>(null);
  const [balanceReadyKey, setBalanceReadyKey] = useState<string | null>(null);
  const cashOutRecipientType: RecipientType =
    state.cashOutDestination === "bitcoin" ? "btc" : "spl_wallet";
  const locksRegtestBtcDestination =
    mode === "cashout" &&
    state.cashOutDestination === "bitcoin" &&
    chainEnv.config.bitcoin.network === "regtest";

  // Cashing out to Solana: SolanaAddressField offers the connected wallet
  // rather than an empty box. That publicly ties the withdrawal to that wallet,
  // so it keeps Edit one tap away.
  const cashesOutToSolana = mode === "cashout" && state.cashOutDestination === "solana";

  useEffect(() => {
    if (!locksRegtestBtcDestination) return;
    const controller = new AbortController();
    setRegtestAddressError(null);
    void (async () => {
      // The regtest dev signer installs a UniSat-compatible wallet shim. Prefer
      // that identity so the redemption returns to the same test user that
      // created it. The Core-owned address is only a local-infra fallback.
      for (let attempt = 0; attempt < 10 && !controller.signal.aborted; attempt++) {
        const accounts = await window.unisat?.getAccounts().catch(() => []);
        const walletAddress = accounts?.[0];
        if (walletAddress) {
          const validation = validateBtcAddress(walletAddress);
          if (!validation.valid || !walletAddress.startsWith("bcrt1")) {
            throw new Error("Connected Bitcoin wallet did not provide a valid regtest address");
          }
          setRegtestBtcAddress(walletAddress);
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      const response = await fetch(
        `/api/regtest/redemption-address?network=${encodeURIComponent(chainEnv.networkId)}`,
        { cache: "no-store", signal: controller.signal },
      );
      const result = await response.json() as { address?: string; error?: string };
      if (!response.ok || !result.address) {
        throw new Error(result.error || "Could not load your regtest wallet address");
      }
      setRegtestBtcAddress(result.address);
    })()
      .catch((fetchError: unknown) => {
        if (!controller.signal.aborted) {
          setRegtestAddressError(fetchError instanceof Error ? fetchError.message : "Could not load your regtest wallet address");
        }
      });
    return () => controller.abort();
  }, [locksRegtestBtcDestination, chainEnv.networkId]);

  useEffect(() => {
    if (locksRegtestBtcDestination && regtestBtcAddress && state.recipient !== regtestBtcAddress) {
      dispatch({ type: "set_recipient", value: regtestBtcAddress });
    }
  }, [locksRegtestBtcDestination, regtestBtcAddress, state.recipient]);

  // Cash out can render before StoreHydration begins its first inbox scan.
  // Request it here too (the store deduplicates concurrent refreshes) and keep
  // the balance in a loading state until that first request settles.
  useEffect(() => {
    if (mode !== "cashout" || !hasVaultKeys) {
      balanceLoadRequested.current = null;
      setBalanceReadyKey(null);
      return;
    }
    if (balanceLoadRequested.current === balanceLoadKey) return;

    balanceLoadRequested.current = balanceLoadKey;
    setBalanceReadyKey(null);
    void Promise.resolve(refreshPrivateBalance()).finally(() => {
      if (balanceLoadRequested.current === balanceLoadKey) {
        setBalanceReadyKey(balanceLoadKey);
      }
    });
  }, [mode, hasVaultKeys, refreshPrivateBalance, balanceLoadKey]);
  // Cash-out constrains the recipient to whichever chain the user picked;
  // Send accepts anything the detection ladder recognizes.
  const recipientAllow = useMemo<readonly RecipientType[] | undefined>(
    () => (mode === "cashout" ? [cashOutRecipientType] : undefined),
    [mode, cashOutRecipientType],
  );
  const recipientResolution = useRecipientResolution(state.recipient, {
    chain: activeChainId,
    allow: recipientAllow,
    disallowedMessage: state.cashOutDestination === "bitcoin"
      ? "Enter a valid Bitcoin address"
      : "Enter a valid Solana wallet address",
  });
  const detection = recipientResolution.detection;

  // For BTC recipient, force zkBTC source.
  const effectiveToken =
    (mode === "cashout" ? cashOutRecipientType : detection.type) === "btc"
      ? "zkBTC"
      : state.sourceToken;

  const resolvedSns = recipientResolution.sns;
  const showAuditorBadge =
    resolvedSns != null &&
    typeof resolvedSns.complianceFlags === "number" &&
    isAuditorDisclosable(resolvedSns as SnsStealthAddress);

  const selectedPayToken = useMemo(
    () =>
      PAY_TOKENS.find((t) => t.shieldedSymbol === effectiveToken) ??
      PAY_TOKENS[0],
    [effectiveToken],
  );
  const usdPerUnit = tokenPrices[selectedPayToken.priceKey] ?? null;
  const displayToken = mode === "cashout" ? selectedPayToken.unit : effectiveToken;
  const {
    relayerMeta,
    relayerMetaLoaded,
    effectiveRelayerFee,
    effectiveServiceFee,
    effectiveServiceFeeBps,
  } =
    useRelayerConfig(selectedPayToken, chainEnv.networkId);

  const linkPayToken = useMemo(
    () =>
      PAY_TOKENS.find((t) => t.shieldedSymbol === linkToken) ?? PAY_TOKENS[0],
    [linkToken],
  );
  const linkRelayerFee = resolveRelayerFee(relayerMeta, linkPayToken);
  const linkNotes = useNoteAutoSelector(linkPayToken.shieldedSymbol, 0);
  const linkAvailable = BigInt(linkNotes.totalAvailable);

  const amountSats = parseDecimalToBaseUnits(state.amount, selectedPayToken.decimals) ?? 0;
  const relayerReady = relayerMetaLoaded && Boolean(relayerMeta?.stealthMeta);
  const totalNeeded = amountSats + effectiveRelayerFee;
  const noteSelector = useNoteAutoSelector(
    selectedPayToken.shieldedSymbol,
    totalNeeded,
  );

  const recipientValid =
    detection.type !== "empty" &&
    detection.type !== "invalid" &&
    detection.type !== "ambiguous" &&
    // Name records must actually resolve on-chain before we let the rest of
    // the form unlock — otherwise the user wastes time picking notes for
    // a recipient that doesn't exist.
    (detection.type !== "stealth_sns" || recipientResolution.status === "found");

  // Narrowed alias used by JSX + buildSendIntent; only meaningful when
  // recipientValid is true (the JSX gates on that before reading it).
  const recipientType = detection.type as RecipientType;

  const amountNum = parseFloat(state.amount || "0");
  const btcServiceFee = computeBtcServiceFee(
    BigInt(Math.max(0, amountSats)),
    effectiveServiceFee,
    effectiveServiceFeeBps,
  );
  const btcNetPayout = BigInt(Math.max(0, amountSats)) - btcServiceFee;
  const isWalletWithdrawal = recipientValid && recipientType === "spl_wallet";
  const withdrawalFee = isWalletWithdrawal
    ? computeBpsFee(BigInt(Math.max(0, amountSats)), poolFees.fees?.withdrawalFeeBps ?? 0)
    : 0n;
  const walletNetPayout = BigInt(Math.max(0, amountSats)) - withdrawalFee;
  const btcAmountTooSmall =
    recipientValid &&
    recipientType === "btc" &&
    amountSats > 0 &&
    btcNetPayout <= 0n;
  const amountValid = recipientValid && amountNum > 0 && amountSats > 0 && !btcAmountTooSmall;
  const formatFee = (amount: bigint | number) => {
    const raw = typeof amount === "bigint" ? amount : BigInt(amount);
    return selectedPayToken.shieldedSymbol === "zkBTC"
      ? `${raw.toLocaleString()} sats`
      : `${formatAmount(Number(raw), selectedPayToken.decimals)} ${selectedPayToken.shieldedSymbol}`;
  };
  const totalFee = BigInt(effectiveRelayerFee) + (recipientType === "btc" ? btcServiceFee : withdrawalFee);
  const highFeeShare = feeShareBps(totalFee, BigInt(Math.max(0, amountSats)) + BigInt(effectiveRelayerFee)) >= 500;

  const totalAvailable = BigInt(noteSelector.totalAvailable);
  const balanceLabel =
    ctx.isLoading || noteSelector.isLoading || (mode === "cashout" && ctx.hasKeys && balanceReadyKey !== balanceLoadKey)
      ? "Loading…"
      : !ctx.hasKeys
        ? "Sign in to view"
        : ctx.inboxError
          ? "Unavailable"
          : `${formatAmount(Number(totalAvailable), selectedPayToken.decimals)} ${displayToken}`;
  const isSubmittingInFlight =
    submitting ||
    (submitter.status !== "idle" &&
      submitter.status !== "success" &&
      submitter.status !== "error");

  // Re-fetch inbox + public balance shortly after a submit lands. Run on a
  // staggered schedule so we catch confirmation across slow RPC paths.
  const scheduleInboxRefresh = useCallback(() => {
    // Keep the global poll in its fast gear past this stagger, in case the note
    // takes longer than ten seconds to be indexed.
    useUTXOpiaStore.getState().expectInboxSoon();
    for (const delay of [2000, 5000, 10000]) {
      setTimeout(() => {
        ctx.refreshInbox(undefined, true);
        if (publicKey) ctx.refreshPublicBalance?.(publicKey);
      }, delay);
    }
  }, [ctx, publicKey]);

  const onSend = useCallback(async () => {
    setError(null);
    setSubmitting(true);
    // The review modal stays open and hosts the progress / result state, so the
    // user tracks the payment to confirmation in one place instead of being
    // navigated away.
    try {
      if (!ctx.keys || !ctx.stealthAddress) {
        throw new Error(
          "Vault locked. Sign in via the gear menu first.",
        );
      }
      if (recipientType === "spl_wallet") {
        const quotedBps = poolFees.fees?.withdrawalFeeBps;
        const latest = await poolFees.refresh();
        if (quotedBps == null || latest.withdrawalFeeBps !== quotedBps) {
          throw new Error("The withdrawal fee changed. Review the updated amount and confirm again.");
        }
      }

      const intent = buildSendIntent({
        recipientType,
        recipientValue: state.recipient.trim(),
        sourceToken: effectiveToken,
        amount: state.amount,
      });

      let mode: "stealth" | "public" | "btc";
      let recipientArg: {
        stealthMeta?: StealthMetaAddress;
        solanaAddress?: string;
        btcScriptPubKey?: Uint8Array;
      };

      switch (intent.kind) {
        case "redeem": {
          const v = validateBtcAddress(intent.recipientValue);
          if (!v.valid || !v.scriptPubKey) {
            throw new Error(v.error || "Invalid Bitcoin address");
          }
          mode = "btc";
          recipientArg = { btcScriptPubKey: v.scriptPubKey };
          break;
        }
        case "transact": {
          if (intent.recipientType === "stealth_sns") {
            const sub = normalizePrivateNameHandle(intent.recipientValue, "solana");
            const r = await lookupSnsName(sub);
            if (!r) {
              throw new Error(
                `Could not resolve ${intent.recipientValue}`,
              );
            }
            recipientArg = {
              stealthMeta: {
                spendingPubKey: new Uint8Array(32),
                viewingPubKey: r.viewingPubKey,
                mpk: r.mpk,
              } as StealthMetaAddress,
            };
          } else {
            recipientArg = {
              stealthMeta: decodeStealthMetaAddress(intent.recipientValue),
            };
          }
          mode = "stealth";
          break;
        }
        case "unshield": {
          mode = "public";
          recipientArg = { solanaAddress: intent.recipientValue };
          break;
        }
        case "claim_link":
          throw new Error(
            "Claim links are generated via the dedicated modal.",
          );
      }

      if (noteSelector.selectedNotes.length === 0) {
        throw new Error(
          "No available private notes can cover this amount.",
        );
      }

      // Withdrawing to the Bitcoin chain (redeem) only makes sense for the
      // BTC-pegged zkBTC. Private send and wallet cash-out work for any token.
      if (effectiveToken !== "zkBTC" && mode === "btc") {
        throw new Error("Only zkBTC can be withdrawn to a Bitcoin address.");
      }

      // For BTC redeem, the proof binds the on-chain signer (the relayer) as requester. Fetch
      // the relayer's pubkey so the bound-params hash matches what the relay will submit.
      let requesterPubkey: Uint8Array | undefined;
      if (mode === "btc") {
        const res = await fetch(
          `/api/sol/relay?network=${encodeURIComponent(chainEnv.networkId)}`,
        );
        if (!res.ok) throw new Error("Could not fetch relayer pubkey for BTC withdrawal");
        const { relayerPubkey } = await res.json();
        if (!relayerPubkey) throw new Error("Relayer pubkey unavailable");
        requesterPubkey = new PublicKey(relayerPubkey).toBytes();
      }

      const params = await buildTransferParams({
        mode,
        amountSats: BigInt(amountSats),
        selectedNotes: noteSelector.selectedNotes,
        keys: ctx.keys,
        selfMeta: ctx.stealthAddress,
        relayerMeta: relayerMeta?.stealthMeta
          ? decodeStealthMetaAddress(relayerMeta.stealthMeta)
          : undefined,
        relayerFee: effectiveRelayerFee,
        boundChainId,
        privacyDomain,
        tokenMint: selectedPayToken.mint || undefined,
        recipient: recipientArg,
        requesterPubkey,
        serviceFeeBase: effectiveServiceFee,
        serviceFeeBps: effectiveServiceFeeBps,
      });

      const submission = await submitter.submit(params, BigInt(amountSats));
      // On failure the submit hook holds the error state, which the modal
      // renders (with Try again); nothing else to do here.
      if (!submission.success || !submission.signature) return;
      scheduleInboxRefresh();

      // Record to the activity log for history, but keep the user on the send
      // page: the modal shows the confirmed result inline with an explorer link
      // and an explicit "View activity" action. The form is reset when the user
      // dismisses the success view (see closeReview).
      const result: SubmittedTransactionKind =
        intent.kind === "redeem"
          ? "cashout_btc"
          : intent.kind === "unshield"
            ? "cashout_wallet"
            : "private_send";
      recordSubmittedTransaction({
        networkId: chainEnv.networkId,
        vaultId: chainEnv.vaultId,
        kind: result,
        amountBaseUnits: BigInt(amountSats),
        netAmountBaseUnits: result === "cashout_btc"
          ? btcNetPayout
          : result === "cashout_wallet"
            ? walletNetPayout
            : BigInt(amountSats),
        protocolFeeBaseUnits: result === "cashout_btc"
          ? btcServiceFee
          : result === "cashout_wallet"
            ? withdrawalFee
            : 0n,
        relayerFeeBaseUnits: BigInt(effectiveRelayerFee),
        tokenSymbol: effectiveToken,
        signature: submission.signature,
        recipient: state.recipient.trim(),
      });
    } catch (e: unknown) {
      // Proof building happens inside here, so an indexer lag lands as a
      // circuit assert rather than anything about indexing.
      setError(humanizeSpendError(e));
    } finally {
      setSubmitting(false);
    }
  }, [
    ctx,
    recipientType,
    state.recipient,
    state.amount,
    effectiveToken,
    lookupSnsName,
    chainEnv.networkId,
    chainEnv.vaultId,
    privacyDomain,
    noteSelector.selectedNotes,
    relayerMeta,
    effectiveRelayerFee,
    effectiveServiceFee,
    effectiveServiceFeeBps,
    boundChainId,
    selectedPayToken.mint,
    submitter,
    amountSats,
    btcNetPayout,
    btcServiceFee,
    walletNetPayout,
    withdrawalFee,
    scheduleInboxRefresh,
    poolFees,
  ]);

  // Explorer link + activity-page target for the confirmed transaction, shown
  // inside the review modal's success view.
  const txHref = submitter.txSignature
    ? getSolanaExplorerTxUrl(submitter.txSignature, chainEnv.networkId)
    : null;
  const activityKind: SubmittedTransactionKind =
    recipientType === "btc"
      ? "cashout_btc"
      : recipientType === "spl_wallet"
        ? "cashout_wallet"
        : "private_send";

  // Closing the review modal: blocked mid-flight (can't cancel a proof), resets
  // the submit hook so a reopen starts clean, and wipes the form only after a
  // successful send so the page returns to a clean slate.
  const closeReview = useCallback(() => {
    if (isSubmittingInFlight) return;
    if (submitter.status === "success") dispatch({ type: "reset" });
    submitter.reset();
    setError(null);
    dispatch({ type: "close_review" });
  }, [isSubmittingInFlight, submitter]);

  const onRetry = useCallback(() => {
    submitter.reset();
    setError(null);
  }, [submitter]);

  const openReview = useCallback(() => {
    dispatch({ type: "open_review" });

    const dimensions = estimateJoinSplitDimensions(
      noteSelector.selectedNotes.map((note) => BigInt(note.amount || 0)),
      BigInt(amountSats),
      BigInt(effectiveRelayerFee),
    );
    if (!dimensions) return;

    // Start downloading the exact wasm/zkey pair while the user reviews the
    // transaction. Confirmation queues behind this preload if it is still in
    // flight, so the same artifacts are never downloaded twice.
    void submitter.preloadCircuit(
      dimensions.nInputs,
      dimensions.nOutputs,
    ).catch((preloadError) => {
      console.warn("[Prover] Circuit preload failed; proof generation will retry on confirm.", preloadError);
    });
  }, [
    amountSats,
    effectiveRelayerFee,
    noteSelector.selectedNotes,
    submitter,
  ]);

  const onViewActivity = useCallback(() => {
    const sig = submitter.txSignature;
    router.push(
      hrefWithChain(
        sig
          ? `/vault/activity?result=${activityKind}&tx=${encodeURIComponent(sig)}`
          : "/vault/activity",
        chainEnv.networkId,
      ),
    );
  }, [router, submitter.txSignature, activityKind, chainEnv.networkId]);

  const onGenerateClaimLink = useCallback(
    async (input: {
      sourceToken: string;
      amount: string;
    }): Promise<ClaimLinkResult> => {
      if (!ctx.keys || !ctx.stealthAddress) {
        throw new Error(
          "Vault locked. Sign in via the gear menu first.",
        );
      }
      const token = PAY_TOKENS.find((t) => t.shieldedSymbol === input.sourceToken) ?? linkPayToken;
      const fee = resolveRelayerFee(relayerMeta, token);
      const sats = parseDecimalToBaseUnits(input.amount, token.decimals);
      if (!sats || sats <= 0) {
        throw new Error("Enter a valid amount");
      }

      const phrase = generateClaimSecret();

      const noteMaster = deriveMasterKey(phrase);
      const noteKeys = await deriveKeysFromSeedCircuit(noteMaster);
      const noteMeta = createStealthMetaAddress(noteKeys);

      const totalNeededLink = sats + fee;
      const linkAvail = ctx.inboxNotes.filter(
        (n) =>
          n.amount > 0n &&
          !n.isSpent &&
          n.tokenSymbol === input.sourceToken,
      );
      const ids = autoSelectNotes(linkAvail, totalNeededLink);
      const linkSelected = linkAvail.filter((n) => ids.has(n.id));
      if (linkSelected.length === 0) {
        throw new Error(
          "No available private notes can cover this amount.",
        );
      }

      const params = await buildTransferParams({
        mode: "stealth",
        amountSats: BigInt(sats),
        selectedNotes: linkSelected,
        keys: ctx.keys,
        selfMeta: ctx.stealthAddress,
        relayerMeta: relayerMeta?.stealthMeta
          ? decodeStealthMetaAddress(relayerMeta.stealthMeta)
          : undefined,
        relayerFee: fee,
        boundChainId,
        privacyDomain,
        tokenMint: token.mint || undefined,
        recipient: { stealthMeta: noteMeta },
      });

      const submission = await submitter.submit(params, BigInt(sats));
      if (!submission.success || !submission.signature) {
        throw new Error(submitter.error ?? "Could not lock funds for the claim link. Please try again.");
      }
      scheduleInboxRefresh();
      recordSubmittedTransaction({
        networkId: chainEnv.networkId,
        kind: "claim_link",
        amountBaseUnits: BigInt(sats),
        tokenSymbol: input.sourceToken,
        signature: submission.signature,
      });

      const origin =
        typeof window !== "undefined" ? window.location.origin : "";
      const url = `${origin}${hrefWithChain("/claim", chainEnv.networkId)}#note=${encodeURIComponent(phrase)}`;
      return { url, secret: phrase };
    },
    [
      ctx,
      relayerMeta,
      submitter,
      scheduleInboxRefresh,
      linkPayToken,
      boundChainId,
      chainEnv.networkId,
      privacyDomain,
    ],
  );

  return (
    <div className="space-y-4">
      {mode === "cashout" && (
        <CashOutDestinationPicker
          value={state.cashOutDestination}
          onChange={(value) => dispatch({ type: "set_destination", value })}
        />
      )}

      {cashesOutToSolana ? (
        <SolanaAddressField
          value={state.recipient}
          onChange={(v) => dispatch({ type: "set_recipient", value: v })}
        />
      ) : (
      <RecipientInput
        value={state.recipient}
        onChange={(v) => dispatch({ type: "set_recipient", value: v })}
        detection={detection}
        label={mode === "cashout"
          ? state.cashOutDestination === "bitcoin"
            ? "Bitcoin address"
            : "Solana wallet address"
          : "Recipient"}
        placeholder={mode === "cashout"
          ? state.cashOutDestination === "bitcoin"
            ? "Paste a Bitcoin address"
            : "Paste a Solana wallet address"
          : undefined}
        snsStatus={recipientResolution.status}
        resolvedAddress={recipientResolution.address}
        readOnly={locksRegtestBtcDestination}
      />
      )}

      {locksRegtestBtcDestination && (
        <p className={cn("text-xs", regtestAddressError ? "text-red-500" : "text-muted-foreground")}>
          {regtestAddressError ?? (regtestBtcAddress
            ? "Regtest safety: BTC withdrawals can only go to your connected test wallet."
            : "Loading your connected regtest wallet address…")}
        </p>
      )}

      {recipientValid && (
        <RecipientOutcome type={recipientType} chainLabel={activeChainLabel} />
      )}

      {showAuditorBadge && (
        <div className="inline-flex flex-col items-start gap-1 px-3 py-1.5 rounded-lg border border-success/30 bg-success/5 text-[11px] text-success">
          <div className="inline-flex items-center gap-1.5 font-mono">
            <span className="w-1.5 h-1.5 rounded-full bg-success" />
            Recipient is auditor-disclosable
          </div>
          {resolvedSns?.auditorPubkey && (
            <div className="font-mono text-[10px] text-success/80 break-all pl-3">
              auditor: {bs58Truncated(resolvedSns.auditorPubkey)}
            </div>
          )}
        </div>
      )}

      {(recipientValid || mode === "cashout") && (
        <>
          <AmountField
            value={state.amount}
            onChange={(v) => dispatch({ type: "set_amount", value: v })}
            decimals={selectedPayToken.decimals}
            unit={selectedPayToken.unit}
            availableBaseUnits={totalAvailable}
            feeBufferBaseUnits={BigInt(effectiveRelayerFee)}
            availableLabel={balanceLabel}
            usdPerUnit={usdPerUnit}
            hint="From your private balance"
            tokenSelector={
              <TokenSourcePicker
                variant="inline"
                recipientType={mode === "cashout" ? cashOutRecipientType : recipientType}
                selected={effectiveToken}
                onSelect={(s) => dispatch({ type: "set_token", value: s })}
                displayPrivateAssets={mode === "cashout"}
              />
            }
          />
          {btcAmountTooSmall && (
            <div className="text-xs text-red-500">
              BTC withdrawal amount must exceed the service fee ({btcServiceFee.toString()} sats).
            </div>
          )}
        </>
      )}

      {amountValid && (
        <FeeSummary
          recipientType={recipientType}
          relayFeeLabel={formatFee(effectiveRelayerFee)}
          serviceFeeLabel={recipientType === "btc" ? formatFee(btcServiceFee) : undefined}
        />
      )}

      {error && <div className="text-xs text-red-500">{error}</div>}

      {(recipientValid || mode === "cashout") && !relayerReady && (
        <div className="text-xs text-amber-600">
          {relayerMetaLoaded
            ? "Relayer fee configuration is unavailable. Sending is temporarily disabled."
            : "Loading relayer fee configuration…"}
        </div>
      )}


      {amountValid && (
        <button
          type="button"
          onClick={openReview}
          disabled={!relayerReady}
          className={cn(
            "w-full px-4 py-3 rounded-lg bg-foreground text-background text-sm font-medium flex items-center justify-center gap-2",
            "disabled:cursor-not-allowed disabled:opacity-50",
          )}
        >
          <Send className="w-4 h-4" />
          {mode === "cashout"
            ? state.cashOutDestination === "bitcoin"
              ? "Review BTC withdrawal"
              : "Review cash out"
            : "Review private transfer"}
        </button>
      )}

      {showClaimLink && (
        <>
          <div className="text-center text-xs text-muted-foreground">— or —</div>

          <button
            type="button"
            onClick={() => {
              setLinkToken(state.sourceToken);
              setLinkOpen(true);
            }}
            disabled={!relayerReady}
            className={cn(
              "w-full px-4 py-3 rounded-lg bg-muted/40 border border-gray/15 text-sm font-medium flex items-center justify-center gap-2 hover:border-privacy/30",
              "disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:border-gray/15",
            )}
          >
            <LinkIcon className="w-4 h-4" />
            Send via claim link
          </button>
        </>
      )}

      <ReviewModal
        open={state.reviewOpen}
        onOpenChange={(o) => {
          if (o) openReview();
          else closeReview();
        }}
        recipientLabel={state.recipient.trim()}
        amountLabel={`${state.amount} ${displayToken}`}
        feeLabel={formatFee(totalFee)}
        details={
          recipientType === "spl_wallet"
            ? [
                { label: "Private balance deducted", value: formatFee(BigInt(amountSats) + BigInt(effectiveRelayerFee)) },
                { label: PRODUCT_COPY.protocol.relayerFee, value: formatFee(effectiveRelayerFee) },
                { label: "Protocol fee", value: `${formatAmount(Number(withdrawalFee), selectedPayToken.decimals)} ${selectedPayToken.unit}` },
                { label: "Wallet receives", value: `${formatAmount(Number(walletNetPayout), selectedPayToken.decimals)} ${selectedPayToken.unit}`, strong: true },
                { label: "Destination", value: state.recipient.trim() },
              ]
            : recipientType === "btc"
              ? [
                  { label: "Private balance deducted", value: formatFee(BigInt(amountSats) + BigInt(effectiveRelayerFee)) },
                  { label: PRODUCT_COPY.protocol.relayerFee, value: formatFee(effectiveRelayerFee) },
                  { label: "Bitcoin service fee", value: formatFee(btcServiceFee) },
                  { label: "Wallet receives", value: `${btcNetPayout.toLocaleString()} sats`, strong: true },
                  { label: "Destination", value: state.recipient.trim() },
                ]
              : [
                  { label: "Private balance deducted", value: formatFee(BigInt(amountSats) + BigInt(effectiveRelayerFee)) },
                  { label: "Recipient receives", value: `${state.amount} ${effectiveToken}`, strong: true },
                  { label: PRODUCT_COPY.protocol.relayerFee, value: formatFee(effectiveRelayerFee) },
                ]
        }
        privacyNote={
          recipientType === "spl_wallet"
            ? `${selectedPayToken.unit} destination and received amount are public on Solana.${effectiveToken === "zkSOL" ? " You receive native SOL." : ""}`
            : recipientType === "btc"
              ? "Bitcoin destination and payout are public."
              : "Sender, recipient, and amount remain private."
        }
        warning={
          highFeeShare
            ? "Fees are high relative to this amount. Review the net amount carefully."
            : detection.type === "btc"
            ? "Withdrawing BTC reveals the destination address on-chain."
            : undefined
        }
        chainId={activeChainId}
        networkId={chainEnv.networkId}
        onConfirm={onSend}
        status={submitter.status}
        busy={isSubmittingInFlight}
        statusMessage={submitter.statusMessage}
        provingElapsed={provingElapsed}
        errorMessage={submitter.error ?? error}
        txHref={txHref}
        onRetry={onRetry}
        onDone={closeReview}
        onViewActivity={onViewActivity}
      />

      <ClaimLinkModal
        open={linkOpen}
        onOpenChange={setLinkOpen}
        onGenerate={onGenerateClaimLink}
        sourceToken={linkToken}
        onSourceTokenChange={setLinkToken}
        availableBaseUnits={linkAvailable}
        availableLabel={
          ctx.isLoading || linkNotes.isLoading
            ? "Loading…"
            : !ctx.hasKeys
              ? "Sign in to view"
              : `${formatAmount(Number(linkAvailable), linkPayToken.decimals)} ${linkPayToken.shieldedSymbol}`
        }
        feeBufferBaseUnits={BigInt(linkRelayerFee)}
        decimals={linkPayToken.decimals}
        unit={linkPayToken.shieldedSymbol}
        usdPerUnit={tokenPrices[linkPayToken.priceKey] ?? null}
        progressMessage={submitter.statusMessage}
      />

      {/* Inline status is the claim-link path's feedback only; the send/cash-out
          path surfaces progress and errors inside the review modal, which stays
          open through the whole lifecycle. */}
      {!state.reviewOpen && isSubmittingInFlight && (
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <Loader2 className="w-3 h-3 animate-spin" />
          {submitter.statusMessage || "Submitting…"}
          {submitter.status === "processing" && provingElapsed >= 3 && (
            <span className="tabular-nums text-muted-foreground/70">{provingElapsed}s</span>
          )}
        </div>
      )}

      {!state.reviewOpen && submitter.status === "error" && submitter.error && (
        <div className="flex flex-col items-start gap-2 px-3 py-2.5 rounded-lg border border-red-500/30 bg-red-500/5 text-xs text-red-500">
          <span className="break-words">{submitter.error}</span>
          <button
            type="button"
            onClick={() => {
              submitter.reset();
            }}
            className="font-medium text-red-400 underline underline-offset-2 hover:text-red-300"
          >
            Dismiss
          </button>
        </div>
      )}
    </div>
  );
}
