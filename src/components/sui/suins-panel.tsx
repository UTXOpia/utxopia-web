"use client";

import { useEffect, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  ExternalLink,
  Loader2,
  Gift,
  Search,
  Tags,
} from "lucide-react";
import { bytesToHex, type StealthMetaAddress } from "@utxopia/sdk";
import type { NetworkId } from "@/lib/network-config";
import {
  findOwnedUtxopiaSuiNsName,
  normalizeSuiNsName,
  resolveSuiNsUtxopiaRecord,
  suinsNetworkFromAppNetwork,
  type SuiNsUtxopiaRecord,
} from "@/lib/sui/suins";
import { claimPrivateReceiveName } from "@/lib/names/private-name-claim";
import { getClaimedSuiNsName, setClaimedSuiNsName } from "@/lib/sui/suins-claimed";
import { getSuiObjectUrl, getSuiTransactionUrl } from "@/lib/chain-links";
import { cn } from "@/lib/utils";

type PanelState = "idle" | "loading" | "success" | "error";

export function SuiNsPanel({
  networkId,
  stealthAddress,
  suiAddress,
  explorerBaseUrl,
}: {
  networkId: NetworkId;
  stealthAddress: StealthMetaAddress | null;
  suiAddress: string | null;
  explorerBaseUrl: string;
}) {
  const [name, setName] = useState("");
  const [record, setRecord] = useState<SuiNsUtxopiaRecord | null>(null);
  const [resolveState, setResolveState] = useState<PanelState>("idle");
  const [claimState, setClaimState] = useState<PanelState>("idle");
  const [message, setMessage] = useState("");
  const [digest, setDigest] = useState<string | null>(null);
  const [ownedRecord, setOwnedRecord] = useState<SuiNsUtxopiaRecord | null>(null);

  const normalized = normalizeSuiNsName(name);
  const suinsNetwork = suinsNetworkFromAppNetwork(networkId);
  const canClaim = Boolean(stealthAddress && suiAddress && name.trim());
  const displayRecord = ownedRecord ?? record;

  // On login, detect a name this Sui address already owns and show it instead of
  // the claim bar. The claimed name is remembered locally (the subname NFT is
  // sponsor-held, so there's no owned object to reverse-look-up); a server-ledger
  // GET is the cross-device fallback. Either way we confirm on-chain that the name
  // still targets this address before showing it.
  useEffect(() => {
    let cancelled = false;
    async function detectOwned() {
      if (!suiAddress) {
        setOwnedRecord(null);
        return;
      }
      // Primary: on-chain ownership of the subname NFT (durable, cross-device).
      let candidate = await findOwnedUtxopiaSuiNsName(suiAddress, networkId).catch(() => null);
      // Fallbacks for names minted before the NFT was transferred to the user.
      if (!candidate) candidate = getClaimedSuiNsName(suiAddress);
      if (!candidate) {
        try {
          const res = await fetch(`/api/sui/suins/claim?loginId=${encodeURIComponent(suiAddress)}`, {
            cache: "no-store",
          });
          const data = (await res.json().catch(() => null)) as
            | { claimed?: boolean; normalizedName?: string }
            | null;
          if (data?.claimed && data.normalizedName) candidate = data.normalizedName;
        } catch {
          // ledger unreachable — fall back to "no owned name"
        }
      }
      if (!candidate) {
        if (!cancelled) setOwnedRecord(null);
        return;
      }
      const rec = await resolveSuiNsUtxopiaRecord(candidate, networkId).catch(() => null);
      if (cancelled) return;
      if (rec?.targetAddress && rec.targetAddress.toLowerCase() === suiAddress.toLowerCase()) {
        setOwnedRecord(rec);
        setClaimedSuiNsName(suiAddress, rec.normalizedName);
      } else {
        setOwnedRecord(null);
      }
    }
    void detectOwned();
    return () => {
      cancelled = true;
    };
  }, [suiAddress, networkId]);

  async function resolveName() {
    if (!name.trim()) {
      setResolveState("error");
      setMessage("Enter a SuiNS name.");
      return;
    }

    setResolveState("loading");
    setMessage("");
    setDigest(null);
    try {
      const next = await resolveSuiNsUtxopiaRecord(name, networkId);
      setRecord(next);
      if (!next) {
        setResolveState("error");
        setMessage(`${normalized} was not found on SuiNS ${suinsNetwork}.`);
        return;
      }
      setResolveState("success");
      setMessage(next.metadata ? "UTXOpia metadata found." : "Name found, but no UTXOpia metadata is published.");
    } catch (error) {
      setResolveState("error");
      setMessage(error instanceof Error ? error.message : "Could not resolve SuiNS name.");
    }
  }

  async function claimSubname() {
    if (!stealthAddress) {
      setClaimState("error");
      setMessage("Create a private wallet before claiming a SuiNS name.");
      return;
    }
    if (!suiAddress) {
      setClaimState("error");
      setMessage("Connect or create a Sui login before claiming a SuiNS name.");
      return;
    }
    if (!name.trim()) {
      setClaimState("error");
      setMessage("Enter a UTXOpia SuiNS name.");
      return;
    }

    setClaimState("loading");
    setMessage("");
    setDigest(null);
    try {
      const result = await claimPrivateReceiveName({
        chain: "sui",
        name,
        networkId,
        suiAddress,
        loginId: suiAddress,
        stealthAddress,
      });
      setDigest(result.digest || null);
      setClaimState("success");
      setMessage(`Claimed ${result.normalizedName}.`);
      if (suiAddress) setClaimedSuiNsName(suiAddress, result.normalizedName);
      try {
        const next = await resolveSuiNsUtxopiaRecord(name, networkId);
        setRecord(next);
        if (next) setOwnedRecord(next);
      } catch {
        setRecord(null);
      }
    } catch (error) {
      setClaimState("error");
      setMessage(error instanceof Error ? error.message : "Could not claim SuiNS name.");
    }
  }

  return (
    <section className="mt-5 rounded-[14px] border border-sui/15 bg-sui/5 p-4 text-left">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[10px] bg-sui/10 text-sui">
            <Tags className="h-5 w-5" />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">SuiNS private name</h2>
            <p className="mt-0.5 text-xs leading-5 text-gray/65">
              {ownedRecord
                ? "Your sponsored receive name for this Sui login."
                : "Claim one sponsored receive name for this Sui login."}
            </p>
          </div>
        </div>
        <span className="shrink-0 rounded-full border border-sui/20 bg-sui/10 px-2 py-1 text-[10px] font-semibold text-sui">
          {suinsNetwork}
        </span>
      </div>

      {!ownedRecord && (
      <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
        <input
          value={name}
          onChange={(event) => {
            setName(event.target.value);
            setMessage("");
            setDigest(null);
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && resolveState !== "loading") resolveName();
          }}
          placeholder="@alice or alice.utxopia.sui"
          className="h-10 min-w-0 rounded-[10px] border border-gray/15 bg-background/55 px-3 font-mono text-xs text-foreground outline-none transition-colors placeholder:text-gray/45 focus:border-sui/45"
        />
        <button
          type="button"
          onClick={resolveName}
          disabled={resolveState === "loading"}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] border border-gray/15 bg-muted/45 px-3 text-xs font-semibold text-gray-light transition-colors hover:border-sui/30 hover:text-foreground disabled:cursor-wait disabled:opacity-60"
        >
          {resolveState === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
          Resolve
        </button>
        <button
          type="button"
          onClick={claimSubname}
          disabled={!canClaim || claimState === "loading"}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-[10px] bg-foreground px-3 text-xs font-semibold text-background transition-colors hover:bg-white disabled:cursor-not-allowed disabled:opacity-50"
        >
          {claimState === "loading" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Gift className="h-3.5 w-3.5" />}
          Claim free name
        </button>
      </div>
      )}

      {displayRecord && (
        <div className="mt-3 rounded-[10px] border border-gray/10 bg-background/35 px-3 py-3">
          {ownedRecord && (
            <p className="mb-2 inline-flex items-center gap-1.5 text-[11px] font-semibold text-sui">
              <CheckCircle2 className="h-3.5 w-3.5" /> Your private name
            </p>
          )}
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-xs font-semibold text-foreground">{displayRecord.normalizedName}</p>
              {displayRecord.targetAddress && (
                <p className="mt-0.5 truncate font-mono text-[11px] text-gray/50">
                  {displayRecord.targetAddress}
                </p>
              )}
            </div>
            {displayRecord.nftId && (
              <a
                href={getSuiObjectUrl(explorerBaseUrl, displayRecord.nftId, networkId)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex shrink-0 items-center gap-1 rounded-[8px] border border-gray/10 px-2 py-1 text-[11px] text-gray transition-colors hover:text-sui"
              >
                NFT <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>

          {displayRecord.metadata ? (
            <div className="grid gap-2">
              <MetadataRow label="viewing" value={bytesToHex(displayRecord.metadata.viewingPubKey)} />
              <MetadataRow label="mpk" value={bytesToHex(displayRecord.metadata.mpk)} />
            </div>
          ) : (
            <p className="text-xs text-gray/55">No UTXOpia receive metadata is attached yet.</p>
          )}
        </div>
      )}

      {(message || digest) && (
        <div
          className={cn(
            "mt-3 flex items-start gap-2 rounded-[10px] border px-3 py-2 text-xs leading-5",
            (resolveState === "error" || claimState === "error")
              ? "border-error/20 bg-error/10 text-error"
              : "border-sui/15 bg-sui/8 text-gray-light",
          )}
        >
          {(resolveState === "error" || claimState === "error")
            ? <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            : <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-sui" />}
          <div className="min-w-0 flex-1">
            {message && <p>{message}</p>}
            {digest && (
              <a
                href={getSuiTransactionUrl(explorerBaseUrl, digest, networkId)}
                target="_blank"
                rel="noreferrer"
                className="mt-1 inline-flex max-w-full items-center gap-1 font-mono text-[11px] text-sui hover:text-sui/80"
              >
                <span className="truncate">{digest}</span>
                <ExternalLink className="h-3 w-3 shrink-0" />
              </a>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function MetadataRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[58px_1fr_auto] items-center gap-2 text-[11px]">
      <span className="text-gray/55">{label}</span>
      <code className="min-w-0 truncate font-mono text-foreground/75">{value}</code>
      <button
        type="button"
        onClick={() => navigator.clipboard?.writeText(value)}
        className="inline-flex h-7 w-7 items-center justify-center rounded-[7px] text-gray transition-colors hover:bg-muted/50 hover:text-foreground"
        aria-label={`Copy ${label}`}
      >
        <Copy className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
