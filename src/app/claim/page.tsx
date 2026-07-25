"use client";

import { Suspense, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import {
  ArrowLeft,
  CheckCircle2,
  Key,
  Loader2,
  LockKeyhole,
} from "lucide-react";
import {
  SOLANA_BOUND_CHAIN_ID,
  createStealthMetaAddress,
  decodeStealthMetaAddress,
  hexToBytes,
} from "@utxopia/sdk";
import { AuthModal } from "@/components/auth-modal";
import { buildTransferParams } from "@/hooks/use-build-transfer-params";
import { useJoinSplitSubmit } from "@/hooks/use-joinsplit-submit";
import { usePasskey } from "@/hooks/use-passkey";
import { useRelayerConfig } from "@/hooks/use-relayer-config";
import { useUTXOpia } from "@/hooks/use-utxopia";
import { scanSecretPhrase, type ScannedSecretNote } from "@/lib/claim-utils";
import {
  calculateClaimReceiveAmount,
  selectUnspentClaimNote,
} from "@/lib/claim-flow";
import { useChainEnvironment } from "@/lib/chain-environment";
import { networkChain, hrefWithChain } from "@/lib/network-config";
import { PAY_TOKENS } from "@/lib/supported-tokens";
import { recordSubmittedTransaction } from "@/lib/transaction-activity";
import { formatAmount } from "@/lib/utils/formatting";
import { cn } from "@/lib/utils";
import { normalizePrivacyDomain } from "@/lib/magicblock-config";
import { PRODUCT_COPY } from "@/lib/product-language";
import { useUTXOpiaStore } from "@/stores/utxopia-store";

function ClaimContent() {
  const { networkId } = useChainEnvironment();
  const ctx = useUTXOpia();
  const wallet = useWallet();
  const { setVisible: setWalletModalVisible } = useWalletModal();
  const submitter = useJoinSplitSubmit();
  const privacyDomain = normalizePrivacyDomain(
    process.env.NEXT_PUBLIC_UTXOPIA_PRIVACY_DOMAIN,
  );
  const [phrase, setPhrase] = useState("");
  const [note, setNote] = useState<ScannedSecretNote | null>(null);
  const [scanning, setScanning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [signature, setSignature] = useState<string | null>(null);
  const [authModalOpen, setAuthModalOpen] = useState(false);

  const {
    isSupported: passkeySupported,
    hasCredential: hasPasskeyCredential,
    isLoading: passkeyLoading,
    error: passkeyError,
    register: registerPasskey,
    authenticate: authenticatePasskey,
  } = usePasskey();
  const deriveKeysFromPasskeySeed = useUTXOpiaStore((state) => state.deriveKeysFromPasskeySeed);
  const loadViewOnlyKeys = useUTXOpiaStore((state) => state.loadViewOnlyKeys);

  useEffect(() => {
    const readClaimHash = () => {
      const match = window.location.hash.match(/(?:^#|&)note=([^&]+)/);
      if (!match) return;
      setNote(null);
      setSignature(null);
      setError(null);
      try {
        setPhrase(decodeURIComponent(match[1]));
      } catch {
        setError("This claim link is malformed.");
      }
      window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
    };
    readClaimHash();
    window.addEventListener("hashchange", readClaimHash);
    return () => window.removeEventListener("hashchange", readClaimHash);
  }, []);

  const token = useMemo(
    () => PAY_TOKENS.find((item) => item.shieldedSymbol === note?.tokenSymbol) ?? PAY_TOKENS[0],
    [note?.tokenSymbol],
  );
  const {
    relayerMeta,
    relayerMetaLoaded,
    effectiveRelayerFee,
  } = useRelayerConfig(token, networkId);
  const receiveAmount = note
    ? BigInt(note.amount) - BigInt(effectiveRelayerFee)
    : 0n;

  const handlePasskeyRegister = async () => {
    const seed = await registerPasskey();
    if (!seed) return;
    await deriveKeysFromPasskeySeed(seed, networkId);
    setAuthModalOpen(false);
  };

  const handlePasskeyAuthenticate = async () => {
    const seed = await authenticatePasskey();
    if (!seed) return;
    await deriveKeysFromPasskeySeed(seed, networkId);
    setAuthModalOpen(false);
  };

  const inspectClaim = async () => {
    const secret = phrase.trim();
    if (secret.length < 8) return;
    if (networkChain(networkId) !== "sol") {
      setError("This claim link belongs to the Solana private-vault network. Switch to Solana and try again.");
      return;
    }
    setScanning(true);
    setError(null);
    setNote(null);
    try {
      const notes = await scanSecretPhrase(secret, networkId);
      setNote(selectUnspentClaimNote(notes));
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Could not inspect this claim link.");
    } finally {
      setScanning(false);
    }
  };

  const claimToVault = async () => {
    if (!note || !ctx.keys || !ctx.stealthAddress || ctx.isViewOnly) {
      setAuthModalOpen(true);
      return;
    }
    if (!relayerMetaLoaded) {
      setError("Fee configuration is still loading. Try again in a moment.");
      return;
    }
    setError(null);
    try {
      const netReceiveAmount = calculateClaimReceiveAmount(note.amount, effectiveRelayerFee);
      const importedNote = {
        amount: BigInt(note.amount),
        ephemeralPub: note.ephemeralPub,
        leafIndex: Number(note.leafIndex),
        commitment: hexToBytes(note.commitment),
        stealthPub: note.stealthPub,
        id: `claim-${note.commitment}`,
        createdAt: note.blockTime ? note.blockTime * 1000 : Date.now(),
        commitmentHex: note.commitment,
        isSpent: false,
        tokenSymbol: note.tokenSymbol,
      };
      const claimMeta = createStealthMetaAddress(note.keys);
      const params = await buildTransferParams({
        mode: "stealth",
        amountSats: netReceiveAmount,
        selectedNotes: [importedNote],
        keys: note.keys,
        selfMeta: claimMeta,
        relayerMeta: relayerMeta?.stealthMeta
          ? decodeStealthMetaAddress(relayerMeta.stealthMeta)
          : undefined,
        relayerFee: effectiveRelayerFee,
        boundChainId: SOLANA_BOUND_CHAIN_ID,
        privacyDomain,
        tokenMint: token.mint || undefined,
        recipient: { stealthMeta: ctx.stealthAddress },
      });
      const result = await submitter.submit(params, netReceiveAmount);
      if (!result.success || !result.signature) {
        throw new Error("The relay did not accept this claim. Please try again.");
      }
      setSignature(result.signature);
      recordSubmittedTransaction({
        networkId,
        kind: "claim_receive",
        amountBaseUnits: netReceiveAmount,
        tokenSymbol: token.shieldedSymbol,
        signature: result.signature,
      });
      window.setTimeout(() => void ctx.refreshInbox(undefined, true), 1_500);
    } catch (claimError) {
      setError(claimError instanceof Error ? claimError.message : "Claim failed.");
    }
  };

  const displayAmount = note
    ? formatAmount(Number(note.amount), token.decimals)
    : null;
  const displayReceiveAmount = note && receiveAmount > 0n
    ? formatAmount(Number(receiveAmount), token.decimals)
    : null;

  return (
    <main className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
      <div className="w-full max-w-[480px] mb-4 relative z-10">
        <Link
          href={hrefWithChain("/vault", networkId)}
          className="inline-flex items-center gap-2 text-body2 text-gray hover:text-gray-light transition-colors"
        >
          <ArrowLeft className="w-4 h-4" />
          Back to Vault
        </Link>
      </div>

      <div className="bg-card border border-solid border-gray/30 p-6 w-[480px] max-w-[calc(100vw-32px)] rounded-[16px] relative z-10">
        <div className="flex items-center gap-3 mb-5">
          <div className="p-2 rounded-[8px] bg-privacy/10">
            <Image src="/brand/logo-transparent-64.png" alt="" width={20} height={20} />
          </div>
          <div>
            <h1 className="text-heading6 text-foreground">Claim private funds</h1>
            <p className="text-caption text-gray">Inspect the private note before claiming it.</p>
          </div>
        </div>

        {signature ? (
          <div className="space-y-4 text-center">
            <CheckCircle2 className="w-10 h-10 text-success mx-auto" />
            <div>
              <p className="text-sm font-semibold text-foreground">Funds claimed</p>
              <p className="text-xs text-gray mt-1">The private note is now available in your vault.</p>
            </div>
            <Link href={hrefWithChain("/vault/activity?refresh=inbox", networkId)} className="btn-primary w-full">
              View activity
            </Link>
          </div>
        ) : (
          <div className="space-y-4">
            <div>
              <label htmlFor="claim-secret" className="text-body2 text-gray-light pl-2 mb-2 block">
                Secret phrase
              </label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray" />
                <input
                  id="claim-secret"
                  type="text"
                  value={phrase}
                  onChange={(event) => {
                    setPhrase(event.target.value);
                    setNote(null);
                    setError(null);
                  }}
                  onKeyDown={(event) => { if (event.key === "Enter") void inspectClaim(); }}
                  placeholder="Enter your secret phrase..."
                  autoComplete="off"
                  spellCheck={false}
                  className={cn(
                    "w-full p-3 pl-10 bg-muted border rounded-[10px]",
                    "text-body2 font-mono text-foreground placeholder:text-gray",
                    "outline-none transition-colors",
                    error ? "border-error/40" : "border-gray/15 focus:border-privacy/40",
                  )}
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs text-error bg-error/8 border border-error/20 rounded-[8px] px-3 py-2">
                {error}
              </p>
            )}

            {note && (
              <div className="rounded-[8px] border border-gray/15 bg-muted/35 px-4 py-3 space-y-2">
                <div className="flex items-center justify-between gap-3 text-sm">
                  <span className="text-gray">Claim note</span>
                  <span className="font-mono font-semibold text-foreground">{displayAmount} {token.shieldedSymbol}</span>
                </div>
                <div className="flex items-center justify-between gap-3 text-xs">
                  <span className="text-gray/70">{PRODUCT_COPY.protocol.relayerFee}</span>
                  <span className="font-mono text-gray">{formatAmount(effectiveRelayerFee, token.decimals)} {token.shieldedSymbol}</span>
                </div>
                {displayReceiveAmount && (
                  <div className="flex items-center justify-between gap-3 text-sm pt-2 border-t border-gray/10">
                    <span className="text-gray">You receive</span>
                    <span className="font-mono font-semibold text-privacy">{displayReceiveAmount} {token.shieldedSymbol}</span>
                  </div>
                )}
              </div>
            )}

            {!note ? (
              <button
                type="button"
                onClick={() => void inspectClaim()}
                disabled={phrase.trim().length < 8 || scanning}
                className="btn-primary w-full"
              >
                {scanning ? <Loader2 className="w-5 h-5 animate-spin" /> : <Key className="w-5 h-5" />}
                {scanning ? "Checking claim..." : "Inspect claim"}
              </button>
            ) : !ctx.keys || ctx.isViewOnly ? (
              <button type="button" onClick={() => setAuthModalOpen(true)} className="btn-primary w-full">
                <LockKeyhole className="w-5 h-5" />
                Unlock destination vault
              </button>
            ) : (
              <button
                type="button"
                onClick={() => void claimToVault()}
                disabled={!relayerMetaLoaded || submitter.status === "processing" || submitter.status === "submitting"}
                className="btn-primary w-full"
              >
                {(submitter.status === "processing" || submitter.status === "submitting") && <Loader2 className="w-5 h-5 animate-spin" />}
                {submitter.statusMessage || "Claim to private vault"}
              </button>
            )}
          </div>
        )}
      </div>

      <AuthModal
        open={authModalOpen}
        onOpenChange={setAuthModalOpen}
        auth={{
          passkeySupported,
          hasPasskeyCredential,
          passkeyLoading,
          walletLoading: ctx.isLoading,
          walletConnected: wallet.connected,
          error: ctx.error || passkeyError,
          onPasskeyRegister: () => void handlePasskeyRegister(),
          onPasskeyAuthenticate: () => void handlePasskeyAuthenticate(),
          onWalletConnect: () => { setAuthModalOpen(false); setWalletModalVisible(true); },
          onWalletDeriveKeys: async () => { await ctx.deriveKeys(); setAuthModalOpen(false); },
          onViewOnlyLogin: (viewingKey) => { void loadViewOnlyKeys(viewingKey); setAuthModalOpen(false); },
        }}
      />
    </main>
  );
}

export default function ClaimPage() {
  return (
    <Suspense fallback={<main className="min-h-screen bg-background" />}>
      <ClaimContent />
    </Suspense>
  );
}
