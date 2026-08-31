"use client";

import { type ReactNode, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Check, Copy, Loader2, QrCode } from "lucide-react";
import { useChainEnvironment } from "@/lib/chain-environment";
import { useUTXOpiaStore } from "@/stores/utxopia-store";
import { useNotesStore } from "@/stores/notes-store";
import { registerDeposit } from "@/lib/api/deposits";
import { deriveTweakDepositForFaucet } from "@/lib/tweak-deposit";
import { DepositStatusTracker } from "@/components/shield-flow/deposit-status-tracker";
import { VaultIdentityUnlock } from "@/components/vault/vault-identity-unlock";
import { MIN_DEPOSIT_SATS } from "@/lib/btc-constants";
import { getMempoolExplorerUrl } from "@/lib/btc-network";
import { useCopyToClipboard } from "@/hooks/use-copy-to-clipboard";
import { cn } from "@/lib/utils";

interface Handout {
  address: string;
  amountSats: number;
  noteId: string;
}

/**
 * Deposit by paying an address, for networks with no faucet and no expectation
 * of a browser wallet: hand out an address, let the member pay it from wherever
 * their coins are, and let the tracker do the rest.
 *
 * The address is registered with the tracker BEFORE it is shown. Nothing on
 * chain identifies this deposit — the only reason anyone is watching that
 * address is that we said so — and here the payment comes from a wallet we do
 * not control, so there is no moment later at which showing it would still be
 * safe.
 */
export function BtcAddressDeposit({
  tokenSelector,
  className,
}: {
  tokenSelector: ReactNode;
  className?: string;
}) {
  const { networkId, vaultId, config } = useChainEnvironment();
  const stealthAddress = useUTXOpiaStore((s) => s.stealthAddressEncoded);
  const hasVault = Boolean(stealthAddress && /^utxo:[0-9a-fA-F]{192}$/.test(stealthAddress));

  const [amountSats, setAmountSats] = useState(20_000);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [handout, setHandout] = useState<Handout | null>(null);
  const { copied, copy } = useCopyToClipboard();

  const belowMinimum = amountSats < MIN_DEPOSIT_SATS;

  async function generate() {
    if (!stealthAddress) return;
    setGenerating(true);
    setError(null);
    try {
      const deposit = await deriveTweakDepositForFaucet(config, stealthAddress);
      const registration = await registerDeposit(
        deposit.depositAddress,
        deposit.notePublicKey,
        amountSats,
        deposit.ephemeralPubkey,
        networkId,
        "tweak",
        vaultId,
      );
      const noteId = useNotesStore.getState().saveNote({
        commitment: deposit.notePublicKey,
        noteExport: "",
        amountSats,
        taprootAddress: deposit.depositAddress,
        depositId: registration.deposit_id,
        expiresAt: Math.floor(Date.now() / 1000) + 86400 * 30,
      });
      setHandout({ address: deposit.depositAddress, amountSats, noteId });
    } catch (cause) {
      setError(
        `Could not create a deposit address: ${cause instanceof Error ? cause.message : String(cause)}`,
      );
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className={cn("space-y-5", className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="text-caption text-gray">Asset</span>
        {tokenSelector}
      </div>

      {!hasVault && <VaultIdentityUnlock />}

      {hasVault && !handout && (
        <div className="space-y-3 rounded-[12px] border border-btc/20 bg-btc/5 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 rounded-[9px] bg-btc/10 p-2">
              <QrCode className="h-4 w-4 text-btc" />
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-body2-semibold text-foreground">Deposit by scanning</p>
              <p className="mt-1 text-caption text-gray">
                We hand out a single-use Bitcoin address. Pay it from any wallet and
                the amount lands in your private balance — the payment carries no
                metadata, so nothing on chain connects it to you.
              </p>
            </div>
          </div>

          <div>
            <label htmlFor="btc-deposit-amount" className="mb-2 block pl-2 text-body2 text-gray-light">
              Amount (sats)
            </label>
            <input
              id="btc-deposit-amount"
              type="number"
              min={MIN_DEPOSIT_SATS}
              step={1000}
              value={amountSats}
              onChange={(event) => setAmountSats(Number(event.target.value) || 0)}
              className={cn(
                "w-full rounded-[12px] border border-gray/15 bg-muted p-3",
                "font-mono text-body2 text-foreground",
                "outline-none transition-colors focus:border-btc/40",
              )}
            />
            <p className="mt-1 pl-2 text-caption text-gray">
              {(amountSats / 1e8).toFixed(8)} BTC. Sending a different amount is fine —
              the tracker credits what actually arrives, as long as it is at least{" "}
              {MIN_DEPOSIT_SATS.toLocaleString()} sats.
            </p>
          </div>

          <button
            type="button"
            onClick={generate}
            disabled={generating || belowMinimum}
            className="btn-primary w-full"
          >
            {generating ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin" />
                Creating deposit address…
              </>
            ) : (
              <>
                <QrCode className="h-5 w-5" />
                Get deposit address
              </>
            )}
          </button>
        </div>
      )}

      {handout && (
        <div className="space-y-4 rounded-[12px] border border-btc/20 bg-btc/5 p-4">
          <div className="flex justify-center rounded-[12px] bg-white p-3">
            <QRCodeSVG
              value={`bitcoin:${handout.address}?amount=${(handout.amountSats / 1e8).toFixed(8)}`}
              size={188}
              level="M"
              marginSize={2}
            />
          </div>

          <div>
            <p className="mb-1 pl-1 text-[10px] uppercase tracking-wider text-gray">
              Send exactly {handout.amountSats.toLocaleString()} sats to
            </p>
            <button
              type="button"
              onClick={() => copy(handout.address)}
              className="flex w-full items-start gap-2 rounded-[8px] border border-gray/15 bg-background/40 p-2 text-left font-mono text-caption text-foreground transition-colors hover:border-btc/30"
            >
              <span className="min-w-0 flex-1 break-all">{handout.address}</span>
              {copied ? (
                <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" />
              ) : (
                <Copy className="mt-0.5 h-3.5 w-3.5 shrink-0 text-gray" />
              )}
            </button>
            <p className="mt-1 pl-1 text-caption text-gray">
              Single use. Coming back here gives you a different address — reusing one
              links the two deposits for anyone watching.
            </p>
          </div>

          <DepositStatusTracker noteId={handout.noteId} showRefresh />

          <div className="flex items-center justify-between gap-2">
            <a
              href={`${getMempoolExplorerUrl(networkId)}/address/${handout.address}`}
              target="_blank"
              rel="noreferrer"
              className="text-caption text-gray transition-colors hover:text-foreground"
            >
              View on explorer
            </a>
            <button
              type="button"
              onClick={() => setHandout(null)}
              className="text-caption text-gray transition-colors hover:text-foreground"
            >
              New address
            </button>
          </div>
        </div>
      )}

      {error && (
        <div className="rounded-[10px] border border-error/30 bg-error/5 p-3 text-caption text-error">
          {error}
        </div>
      )}
    </div>
  );
}
