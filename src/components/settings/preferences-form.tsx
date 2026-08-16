"use client";

import { useState } from "react";
import Link from "next/link";
import { Loader2, ChevronRight } from "lucide-react";
import { PublicKey } from "@solana/web3.js";
import { useUiMode } from "@/hooks/use-ui-mode";
import { useSnsName, type SnsStaleName } from "@/hooks/use-sns-name";
import { cn } from "@/lib/utils";
import { NetworkSelector } from "@/components/settings/network-selector";
import { RelaySelector } from "@/components/settings/relay-selector";
import { InfoTip } from "@/components/ui/info-tip";
import { SnsComplianceFlags } from "@utxopia/sdk";
import { useChainEnvironment } from "@/lib/chain-environment";
import { hrefWithChain } from "@/lib/network-config";
import { claimPrivateReceiveName } from "@/lib/names/private-name-claim";
import { getSnsConfig } from "@/lib/names/sns";
import { formatSnsHandle } from "@/lib/names/format";
import { ChangeNameDialog } from "@/components/change-name-dialog";

/**
 * Settings — grouped into three semantic sections (Network · Identity ·
 * Sending). Each group is a flat list of rows separated by hairlines —
 * no card-on-card wrappers, no repeated borders. Color is applied with
 * intent: privacy green for active/enabled signals, neutral gray for
 * everything else.
 */
export function PreferencesForm() {
  const { isAdvanced } = useUiMode();
  const { config, networkId } = useChainEnvironment();
  // Phase 1: read-only.
  const advancedDisabled = true;

  return (
    <div className="space-y-12">
      <Section label="Network">
        <NetworkSelector />
      </Section>

      <Section
        label="Relayer"
        hintNode={
          <InfoTip label="About relays">
            Relayers submit prepared private transactions to Solana without using
            your connected wallet as the fee payer. They can&apos;t change a proof
            or spend your funds.{" "}
            <span className="text-gray/70">
              Permissioned-pool deposits are submitted via the pool&apos;s
              auditor; relayer selection applies to all other sends.
            </span>
          </InfoTip>
        }
      >
        <RelaySelector chainId={config.chain ?? "solana"} networkId={networkId} />
      </Section>

      <Section
        label="Identity"
        hint="What senders see when they enter your .utxopia.sol name."
      >
        <SnsNameRow />
        <AuditorDisclosableRow />
        <AuditorPubkeyRow />
      </Section>

      <Section label="Sending">
        <ToggleRow
          title="Advanced send"
          chip={advancedDisabled ? "Coming soon" : undefined}
          enabled={isAdvanced}
          disabled={advancedDisabled}
          description={
            <>
              Multi-output sends (batch to multiple recipients in one ZK
              proof), custom Bitcoin fee rate, and manual coin selection.
            </>
          }
        />
      </Section>

      <Section
        label="Advanced"
        hint="Tools for permissioned-pool operators and auditors."
      >
        <AuditorDashboardLinkRow />
      </Section>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Layout primitives                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Semantic settings group. Renders a small uppercase eyebrow label, an
 * optional one-line hint, then its children as a flat hairline-separated
 * list. Children should be Row primitives, not cards.
 */
function Section({
  label,
  hint,
  hintNode,
  children,
}: {
  label: string;
  hint?: string;
  /** Rich node alternative to the plain `hint` string. Rendered to the right of the label. */
  hintNode?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-3 px-1">
        <h2 className="text-[11px] uppercase tracking-[0.18em] text-gray-light font-semibold">
          {label}
        </h2>
        {hintNode ?? (hint && (
          <span className="text-[11px] text-gray/70 truncate">{hint}</span>
        ))}
      </div>
      <div className="divide-y divide-gray/10">
        {children}
      </div>
    </section>
  );
}

/**
 * Single row: title + status chips + info disclosure + control. The
 * description lives inside <InfoTip> so the visible row stays one line.
 */
function ToggleRow({
  title,
  chip,
  description,
  enabled,
  disabled,
  onToggle,
  activeAccent = "privacy",
}: {
  title: string;
  chip?: string;
  description: React.ReactNode;
  enabled: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  activeAccent?: "privacy" | "success";
}) {
  return (
    <div className={cn("py-4 px-1", disabled && "opacity-60")}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-medium text-foreground">{title}</span>
          {chip && (
            <span className="text-[10px] uppercase tracking-wide text-gray bg-muted/40 px-1.5 py-0.5 rounded">
              {chip}
            </span>
          )}
          <InfoTip label={`About ${title}`}>{description}</InfoTip>
        </div>
        <Toggle
          enabled={enabled}
          disabled={disabled}
          onToggle={onToggle}
          activeAccent={activeAccent}
        />
      </div>
    </div>
  );
}

function Toggle({
  enabled,
  disabled,
  onToggle,
  activeAccent = "privacy",
}: {
  enabled: boolean;
  disabled?: boolean;
  onToggle?: () => void;
  activeAccent?: "privacy" | "success";
}) {
  const activeColor =
    activeAccent === "privacy" ? "bg-privacy" : "bg-success";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={enabled}
      disabled={disabled}
      onClick={onToggle}
      className={cn(
        "shrink-0 w-10 h-6 rounded-full p-0.5 transition-colors duration-200",
        enabled ? activeColor : "bg-muted",
        disabled && "cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "block w-5 h-5 rounded-full bg-background transition-transform duration-200 ease-out",
          enabled ? "translate-x-4" : "translate-x-0",
        )}
      />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/*  Identity rows                                                             */
/* -------------------------------------------------------------------------- */

/**
 * Receive name — shows the registered .utxopia.sol name and lets the user
 * register or change it. Changing registers a new subdomain on-chain.
 */
function SnsNameRow() {
  const sns = useSnsName();
  const { networkId, config } = useChainEnvironment();
  const parentDomain = getSnsConfig(config)?.parentDomain || "utxopia";
  const [editing, setEditing] = useState(false);
  const [changeOpen, setChangeOpen] = useState(false);
  const [value, setValue] = useState("");
  const disabled = !sns.canRegister || sns.isLoading;
  const fullName = sns.hasRegisteredSnsName
    ? `${sns.registeredSnsName}.${parentDomain}.sol`
    : null;

  async function handleSave() {
    const name = value.trim().toLowerCase();
    if (!name || name === sns.registeredSnsName) return;
    try {
      await claimPrivateReceiveName({
        chain: "solana",
        name,
        networkId,
        solanaClaim: sns.registerSnsSubdomain,
      });
      setEditing(false);
      setValue("");
    } catch {
      // useSnsName owns the user-facing error state.
    }
  }

  return (
    <div className={cn("py-4 px-1", disabled && "opacity-60")}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-medium text-foreground">
            Private receive name
          </span>
          {!sns.canRegister && (
            <span className="text-[10px] uppercase tracking-wide text-gray bg-muted/40 px-1.5 py-0.5 rounded">
              Wallet required
            </span>
          )}
          {sns.isRegistering && (
            <Loader2 className="w-3 h-3 animate-spin text-gray" />
          )}
          <InfoTip label="About private receive names">
            A public on-chain name that resolves to your private receive
            address, so senders can type{" "}
            <span className="font-mono">name.{parentDomain}.sol</span>{" "}
            instead of a long address. Registering a new name replaces the
            one senders should use; it does not expose your balances or
            history.
          </InfoTip>
        </div>
        {!editing && (
          <div className="flex items-center gap-2 min-w-0">
            {fullName && (
              // Handle on screen, full name in the tooltip — this is the same
              // identity as the vault header and has to read the same way.
              <span
                title={fullName}
                className="text-[12px] font-mono text-privacy truncate"
              >
                {formatSnsHandle(sns.registeredSnsName!)}
              </span>
            )}
            <button
              type="button"
              onClick={() => {
                // Registered names can't be renamed in place — open the
                // change dialog (register new + release old). No name yet →
                // inline register editor.
                if (sns.hasRegisteredSnsName) {
                  setChangeOpen(true);
                  return;
                }
                setValue(sns.registeredSnsName ?? "");
                setEditing(true);
              }}
              disabled={disabled}
              className={cn(
                "shrink-0 px-3 py-1.5 text-[11px] font-medium rounded-md transition-all",
                disabled
                  ? "bg-muted/40 text-gray cursor-not-allowed"
                  : "bg-muted/40 text-gray-light hover:text-foreground hover:bg-muted/60",
              )}
            >
              {fullName ? "Change" : "Register"}
            </button>
          </div>
        )}
      </div>

      {editing && (
        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value.toLowerCase())}
            disabled={sns.isRegistering}
            placeholder="yourname"
            className={cn(
              "flex-1 min-w-0 px-3 py-1.5 rounded-md bg-muted/40 border border-gray/10",
              "text-[12px] font-mono outline-none",
              "focus:border-privacy/40 focus:bg-muted/60 transition-colors",
            )}
          />
          <span className="text-[12px] text-gray shrink-0">.{parentDomain}.sol</span>
          <button
            type="button"
            onClick={() => {
              setEditing(false);
              setValue("");
            }}
            disabled={sns.isRegistering}
            className="text-[11px] text-gray hover:text-foreground transition-colors px-2"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleSave}
            disabled={
              sns.isRegistering ||
              !value.trim() ||
              value.trim() === sns.registeredSnsName
            }
            className={cn(
              "shrink-0 px-3 py-1.5 text-[11px] font-medium rounded-md transition-all",
              value.trim() && value.trim() !== sns.registeredSnsName && !sns.isRegistering
                ? "bg-foreground text-background hover:bg-white"
                : "bg-muted/40 text-gray cursor-not-allowed",
            )}
          >
            {sns.isRegistering ? "Registering..." : fullName ? "Change name" : "Register name"}
          </button>
        </div>
      )}

      <StaleNamesNotice
        staleNames={sns.staleNames}
        parentDomain={parentDomain}
        busy={sns.isRegistering}
        onRelease={sns.releaseStaleName}
      />

      {sns.error && (
        <p className="text-xs text-error mt-2 font-mono break-all">{sns.error}</p>
      )}

      {sns.hasRegisteredSnsName && (
        <ChangeNameDialog open={changeOpen} onOpenChange={setChangeOpen} />
      )}
    </div>
  );
}

/**
 * Names left behind when the release half of a change never landed. They still
 * resolve to this user, and which one senders get is arbitrary — so surface them
 * with a release action instead of letting one silently shadow the current name.
 */
export function StaleNamesNotice({
  staleNames,
  parentDomain,
  busy,
  onRelease,
}: {
  staleNames: SnsStaleName[];
  parentDomain: string;
  busy: boolean;
  onRelease: (name: string) => Promise<boolean>;
}) {
  const [releasing, setReleasing] = useState<string | null>(null);

  if (staleNames.length === 0) return null;

  async function handleRelease(name: string) {
    setReleasing(name);
    try {
      await onRelease(name);
    } finally {
      setReleasing(null);
    }
  }

  return (
    <div className="mt-3 rounded-md border border-warning/25 bg-warning/10 px-3 py-2">
      <p className="text-[11px] leading-4 text-gray-light">
        {staleNames.length === 1 ? "An older name still resolves" : "Older names still resolve"}{" "}
        to your account from a name change that didn&apos;t finish. Senders may be
        shown either one — release what you no longer want.
      </p>
      <ul className="mt-2 space-y-1.5">
        {staleNames.map((stale) => (
          <li key={stale.subdomainKey} className="flex items-center justify-between gap-2">
            <span className="text-[12px] font-mono text-gray-light truncate">
              {stale.name ? `${stale.name}.${parentDomain}.sol` : `${stale.subdomainKey.slice(0, 8)}…`}
            </span>
            <button
              type="button"
              onClick={() => stale.name && handleRelease(stale.name)}
              disabled={!stale.name || busy || releasing !== null}
              className={cn(
                "shrink-0 px-3 py-1.5 text-[11px] font-medium rounded-md transition-all",
                !stale.name || busy || releasing !== null
                  ? "bg-muted/40 text-gray cursor-not-allowed"
                  : "bg-muted/40 text-gray-light hover:text-foreground hover:bg-muted/60",
              )}
            >
              {stale.name !== null && releasing === stale.name ? "Releasing..." : "Release"}
            </button>
          </li>
        ))}
      </ul>
      <p className="mt-2 text-[10px] leading-4 text-gray">
        Releasing needs a signature from the wallet that registered the name, and
        frees it for anyone else to claim.
      </p>
    </div>
  );
}

/**
 * AUDITOR_DISCLOSABLE flag — surfaces on the user's .utxopia.sol record
 * as a public signal that they accept outgoing audit memos. Doesn't
 * leak any key material; that still happens via DelegatedViewKey.
 */
function AuditorDisclosableRow() {
  const sns = useSnsName();
  const enabled =
    (sns.complianceFlags & SnsComplianceFlags.AUDITOR_DISCLOSABLE) !== 0;
  const disabled =
    !sns.hasRegisteredSnsName || sns.isRegistering || sns.isLoading;

  async function handleToggle() {
    if (disabled) return;
    const next = enabled
      ? sns.complianceFlags & ~SnsComplianceFlags.AUDITOR_DISCLOSABLE
      : sns.complianceFlags | SnsComplianceFlags.AUDITOR_DISCLOSABLE;
    await sns.setComplianceFlag(next);
  }

  return (
    <div className={cn("py-4 px-1", disabled && "opacity-60")}>
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0 flex-wrap">
          <span className="text-sm font-medium text-foreground">
            Auditor-disclosable
          </span>
          {!sns.hasRegisteredSnsName && (
            <span className="text-[10px] uppercase tracking-wide text-gray bg-muted/40 px-1.5 py-0.5 rounded">
              No SNS
            </span>
          )}
          {sns.isRegistering && (
            <Loader2 className="w-3 h-3 animate-spin text-gray" />
          )}
          <InfoTip label="About Auditor-disclosable">
            Publishes a public signal on your `.utxopia.sol` record that
            you&apos;re OK receiving outgoing audit memos. Senders see an
            &quot;Auditor-disclosable&quot; chip when they enter your name. Your
            viewing keys are <strong>not</strong> shared by this flag —
            you still issue DelegatedViewKeys to specific auditors
            separately.
          </InfoTip>
        </div>
        <Toggle enabled={enabled} disabled={disabled} onToggle={handleToggle} />
      </div>
      {sns.error && (
        <p className="text-xs text-error mt-2 font-mono break-all">
          {sns.error}
        </p>
      )}
    </div>
  );
}

/**
 * Optional pubkey hint that pairs with the AUDITOR_DISCLOSABLE flag.
 * Visually nested under it via a subtle indent + connector rail.
 */
function AuditorPubkeyRow() {
  const sns = useSnsName();
  const currentBase58 = sns.auditorPubkey
    ? new PublicKey(sns.auditorPubkey).toBase58()
    : "";
  const [value, setValue] = useState(currentBase58);
  const [parseError, setParseError] = useState<string | null>(null);
  const disabled =
    !sns.hasRegisteredSnsName || sns.isRegistering || sns.isLoading;
  const dirty = value.trim() !== currentBase58;

  async function handleSave() {
    setParseError(null);
    const trimmed = value.trim();
    if (trimmed === "") {
      await sns.setAuditorPubkey(null);
      return;
    }
    let pubkey: PublicKey;
    try {
      pubkey = new PublicKey(trimmed);
    } catch {
      setParseError("Must be a base58 Solana pubkey (32 bytes).");
      return;
    }
    await sns.setAuditorPubkey(pubkey);
  }

  return (
    <div className={cn("py-4 px-1", disabled && "opacity-60")}>
      {/* Nested under Auditor-disclosable — indent + soft rail */}
      <div className="pl-4 border-l border-gray/15">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm font-medium text-foreground">
            Designated auditor
          </span>
          <span className="text-[10px] uppercase tracking-wide text-gray">
            optional
          </span>
          <InfoTip label="About Designated auditor">
            Public Solana pubkey of the auditor you&apos;ve issued a
            DelegatedViewKey to (off-chain). Senders see this in the
            badge when they enter your name. Leave blank to publish only
            the flag bit.
          </InfoTip>
        </div>

        <div className="mt-2 flex items-center gap-2">
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={disabled}
            placeholder="Base58 Solana pubkey"
            className={cn(
              "flex-1 min-w-0 px-3 py-1.5 rounded-md bg-muted/40 border border-gray/10",
              "text-[12px] font-mono outline-none",
              "focus:border-privacy/40 focus:bg-muted/60 transition-colors",
              disabled && "cursor-not-allowed",
            )}
          />
          {dirty && (
            <button
              type="button"
              onClick={() => {
                setValue(currentBase58);
                setParseError(null);
              }}
              disabled={disabled}
              className="text-[11px] text-gray hover:text-foreground transition-colors px-2"
            >
              Reset
            </button>
          )}
          <button
            type="button"
            onClick={handleSave}
            disabled={disabled || !dirty}
            className={cn(
              "shrink-0 px-3 py-1.5 text-[11px] font-medium rounded-md transition-all",
              dirty && !disabled
                ? "bg-foreground text-background hover:bg-white"
                : "bg-muted/40 text-gray cursor-not-allowed",
            )}
          >
            {value.trim() === "" ? "Clear" : "Save"}
          </button>
        </div>

        {parseError && (
          <p className="mt-1.5 text-[11px] text-error font-mono">
            {parseError}
          </p>
        )}
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Advanced section rows                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Low-key link to the permissioned-pool auditor workspace.
 * Not a primary nav item — rendered in the Advanced section of Settings,
 * near the auditor pubkey configuration rows.
 */
function AuditorDashboardLinkRow() {
  const { networkId } = useChainEnvironment();
  return (
    <Link
      href={hrefWithChain("/auditor", networkId)}
      className={cn(
        "group flex items-center justify-between gap-4 py-4 px-1 transition-colors",
        "hover:text-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-privacy/40 rounded-sm",
      )}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="text-sm font-medium text-foreground">
          Auditor workspace
        </span>
        <span className="text-[10px] uppercase tracking-wide text-gray bg-muted/40 px-1.5 py-0.5 rounded">
          Permissioned pools
        </span>
        <InfoTip label="About the auditor workspace">
          Use an authorized viewing key to decrypt permissioned-pool records.
          The key is not stored and remains only in this browser tab during the scan.
        </InfoTip>
      </div>
      <ChevronRight
        className="w-4 h-4 text-gray group-hover:text-gray-light transition-colors shrink-0"
        aria-hidden="true"
      />
    </Link>
  );
}
