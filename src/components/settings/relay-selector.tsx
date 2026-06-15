"use client";

import { useEffect, useId, useRef, useState } from "react";
import { X, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { useRelays, useEffectiveRelay } from "@/hooks/use-relay";
import { useRelayStore } from "@/stores/relay-store";
import { pingRelay } from "@/lib/relay-health";
import type { RelayConfig } from "@/lib/relays";
import type { RelayHealth } from "@/lib/relay-health";

/**
 * Relay selector — mirrors NetworkSelector's radio-row list pattern.
 *
 * Row 0: "Automatic (recommended)" — resolves via health, rotates among
 *   healthy relays to limit fingerprinting.
 * Row 1…n: One row per relay (builtins + customs). Custom rows have a
 *   remove (×) button.
 * Footer: inline add-custom-relay form (no modal).
 *
 * Health is probed on mount + via an optional "Recheck" affordance.
 * Results drive the green/amber/gray dot + latency caption.
 */

// ---------------------------------------------------------------------------
// Health status config — mirrors STATUS_CONFIG from withdrawal-status.tsx
// ---------------------------------------------------------------------------

const HEALTH_CONFIG: Record<
  RelayHealth["status"] | "checking",
  { label: string; dotClass: string; captionClass: string }
> = {
  online: {
    label: "Online",
    dotClass: "bg-success",
    captionClass: "text-success",
  },
  slow: {
    label: "Slow",
    dotClass: "bg-warning",
    captionClass: "text-warning",
  },
  offline: {
    label: "Offline",
    dotClass: "bg-gray/40",
    captionClass: "text-gray",
  },
  checking: {
    label: "Checking…",
    dotClass: "bg-gray/30 animate-pulse",
    captionClass: "text-gray/60",
  },
};

// ---------------------------------------------------------------------------
// Prop / component types
// ---------------------------------------------------------------------------

interface RelaySelectorProps {
  /** Chain id — passed to useRelays / url(networkId). */
  chainId: string;
  /** Full network id — passed to relay.url() when pinging. */
  networkId: string;
}

// ---------------------------------------------------------------------------
// Main exported component
// ---------------------------------------------------------------------------

export function RelaySelector({ chainId, networkId }: RelaySelectorProps) {
  const relays = useRelays(chainId);
  const mode = useRelayStore((s) => s.mode);
  const health = useRelayStore((s) => s.health);
  const setMode = useRelayStore((s) => s.setMode);
  const addCustomRelay = useRelayStore((s) => s.addCustomRelay);
  const removeCustomRelay = useRelayStore((s) => s.removeCustomRelay);
  const setHealth = useRelayStore((s) => s.setHealth);

  const effective = useEffectiveRelay(chainId);

  // Track which relay ids are currently being pinged so we can show
  // a "checking" dot without clobbering existing health records.
  const [checking, setChecking] = useState<Set<string>>(new Set());

  // Whether the inline add-custom form is open.
  const [addOpen, setAddOpen] = useState(false);

  // Run health checks for all relays.
  async function runHealthChecks() {
    const ids = relays.map((r) => r.id);
    setChecking(new Set(ids));
    await Promise.all(
      relays.map(async (relay) => {
        const url = relay.url(networkId);
        const result = await pingRelay(url);
        setHealth(relay.id, result);
        setChecking((prev) => {
          const next = new Set(prev);
          next.delete(relay.id);
          return next;
        });
      }),
    );
  }

  // Check on mount (relays array is stable until custom relays change).
  const checkedRef = useRef(false);
  useEffect(() => {
    if (checkedRef.current) return;
    checkedRef.current = true;
    runHealthChecks();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const isPinned = mode !== "auto";

  return (
    <div className="space-y-3">
      {/* Radio row list */}
      <ul
        role="radiogroup"
        aria-label="Relay selection"
        className="divide-y divide-gray/10 border-y border-gray/10"
      >
        {/* Row 0: Auto */}
        <AutoRow
          active={mode === "auto"}
          effective={effective}
          effectiveHealth={
            effective
              ? checking.has(effective.id)
                ? null
                : (health[effective.id] ?? null)
              : null
          }
          effectiveChecking={!!effective && checking.has(effective.id)}
          onSelect={() => setMode("auto")}
        />

        {/* Row 1…n: per-relay */}
        {relays.map((relay) => (
          <RelayRow
            key={relay.id}
            relay={relay}
            active={mode === relay.id}
            health={checking.has(relay.id) ? null : (health[relay.id] ?? null)}
            checking={checking.has(relay.id)}
            onSelect={() => setMode(relay.id)}
            onRemove={relay.custom ? () => removeCustomRelay(relay.id) : undefined}
          />
        ))}
      </ul>

      {/* Anti-fingerprint nudge — shown only when a relay is pinned. */}
      {isPinned && (
        <p
          className={cn(
            "px-1 text-[11px] text-gray/70 leading-snug",
            "transition-opacity duration-200 motion-reduce:transition-none",
          )}
          role="note"
        >
          Always using one relay is more identifiable. Auto rotates among
          healthy relays.
        </p>
      )}

      {/* Footer: recheck + add-custom */}
      <div className="flex items-center justify-between px-1 gap-3">
        <button
          type="button"
          onClick={runHealthChecks}
          disabled={checking.size > 0}
          className={cn(
            "inline-flex items-center gap-1.5 text-[11px] text-gray transition-colors",
            "hover:text-foreground disabled:opacity-40 disabled:cursor-not-allowed",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded",
          )}
        >
          <RotateCcw className={cn("w-3 h-3", checking.size > 0 && "animate-spin")} />
          Recheck
        </button>

        {!addOpen && (
          <button
            type="button"
            onClick={() => setAddOpen(true)}
            className={cn(
              "text-[11px] text-gray transition-colors",
              "hover:text-foreground",
              "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded",
            )}
          >
            + Add custom relay
          </button>
        )}
      </div>

      {/* Inline add-custom form */}
      {addOpen && (
        <AddCustomForm
          onSubmit={(name, url) => {
            addCustomRelay({ name, url });
            setAddOpen(false);
            // Kick off a health check for the new relay — it will appear
            // in the list on the next render cycle after the store updates.
            setTimeout(() => runHealthChecks(), 50);
          }}
          onCancel={() => setAddOpen(false)}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Auto row
// ---------------------------------------------------------------------------

function AutoRow({
  active,
  effective,
  effectiveHealth,
  effectiveChecking,
  onSelect,
}: {
  active: boolean;
  effective: RelayConfig | null;
  effectiveHealth: RelayHealth | null;
  effectiveChecking: boolean;
  onSelect: () => void;
}) {
  const id = useId();

  // Sub-line: "via Utxopia relay · 42ms" or "checking…"
  let subLine: React.ReactNode;
  if (effective) {
    if (effectiveChecking) {
      subLine = <span className="text-gray/60 animate-pulse">Checking…</span>;
    } else if (effectiveHealth) {
      const cfg = HEALTH_CONFIG[effectiveHealth.status];
      subLine = (
        <span className="inline-flex items-center gap-1.5">
          <span
            className={cn(
              "inline-block h-1.5 w-1.5 rounded-full shrink-0",
              cfg.dotClass,
            )}
            aria-hidden
          />
          <span className="text-gray">
            via {effective.name}
            {effectiveHealth.latencyMs != null
              ? ` · ${effectiveHealth.latencyMs}ms`
              : ""}
          </span>
        </span>
      );
    } else {
      subLine = (
        <span className="text-gray/60">via {effective.name}</span>
      );
    }
  } else {
    subLine = <span className="text-gray/60">No healthy relay found</span>;
  }

  return (
    <li>
      <div
        className={cn(
          "group relative py-3 px-1 transition-colors duration-150 motion-reduce:transition-none",
          active ? "bg-privacy/[0.04]" : "hover:bg-muted/20",
        )}
      >
        <div className="flex items-start gap-3">
          {/* Radio indicator */}
          <input
            type="radio"
            id={id}
            name="relay"
            value="auto"
            checked={active}
            onChange={onSelect}
            className="sr-only"
          />
          <label
            htmlFor={id}
            className={cn(
              "shrink-0 mt-1 h-3.5 w-3.5 rounded-full transition-all duration-200 motion-reduce:transition-none",
              "flex items-center justify-center cursor-pointer",
              "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
              active
                ? "bg-privacy ring-2 ring-privacy/30 ring-offset-2 ring-offset-background"
                : "border border-gray/40 hover:border-foreground/60 group-hover:border-foreground/40",
            )}
            aria-hidden
          />

          <div className="flex-1 min-w-0">
            <label
              htmlFor={id}
              className="block w-full cursor-pointer select-none"
            >
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className={cn(
                    "text-sm transition-colors",
                    active
                      ? "text-foreground font-semibold"
                      : "text-foreground/85 font-medium group-hover:text-foreground",
                  )}
                >
                  Automatic
                </span>
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-[0.14em] font-semibold",
                    active ? "text-privacy" : "text-gray/60",
                  )}
                >
                  {active ? "Active · Recommended" : "Recommended"}
                </span>
              </div>
              <p className="text-[11px] text-gray mt-0.5">{subLine}</p>
            </label>
          </div>
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Per-relay row
// ---------------------------------------------------------------------------

function RelayRow({
  relay,
  active,
  health,
  checking,
  onSelect,
  onRemove,
}: {
  relay: RelayConfig;
  active: boolean;
  health: RelayHealth | null;
  checking: boolean;
  onSelect: () => void;
  onRemove?: () => void;
}) {
  const id = useId();

  const statusKey: keyof typeof HEALTH_CONFIG = checking
    ? "checking"
    : (health?.status ?? "checking");
  const cfg = HEALTH_CONFIG[statusKey];

  const latencyCaption =
    !checking && health?.latencyMs != null ? `${health.latencyMs}ms` : null;

  return (
    <li>
      <div
        className={cn(
          "group relative py-3 px-1 transition-colors duration-150 motion-reduce:transition-none",
          active ? "bg-privacy/[0.04]" : "hover:bg-muted/20",
        )}
      >
        <div className="flex items-start gap-3">
          {/* Radio indicator */}
          <input
            type="radio"
            id={id}
            name="relay"
            value={relay.id}
            checked={active}
            onChange={onSelect}
            className="sr-only"
          />
          <label
            htmlFor={id}
            className={cn(
              "shrink-0 mt-1 h-3.5 w-3.5 rounded-full transition-all duration-200 motion-reduce:transition-none",
              "flex items-center justify-center cursor-pointer",
              "focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 focus-within:ring-offset-background",
              active
                ? "bg-privacy ring-2 ring-privacy/30 ring-offset-2 ring-offset-background"
                : "border border-gray/40 hover:border-foreground/60 group-hover:border-foreground/40",
            )}
            aria-hidden
          />

          <div className="flex-1 min-w-0">
            <label
              htmlFor={id}
              className="block w-full cursor-pointer select-none"
            >
              <div className="flex items-baseline gap-2 flex-wrap">
                <span
                  className={cn(
                    "text-sm transition-colors",
                    active
                      ? "text-foreground font-semibold"
                      : "text-foreground/85 font-medium group-hover:text-foreground",
                  )}
                >
                  {relay.name}
                </span>
                {relay.region && (
                  <span className="text-[11px] text-gray font-mono">
                    {relay.region}
                  </span>
                )}
                {active && (
                  <span className="text-[9px] uppercase tracking-[0.15em] font-semibold text-privacy">
                    Active
                  </span>
                )}
                {relay.custom && (
                  <span className="text-[10px] uppercase tracking-[0.1em] text-gray bg-muted/40 px-1.5 py-0.5 rounded">
                    Custom
                  </span>
                )}
              </div>
              <p className="text-[11px] text-gray mt-0.5 inline-flex items-center gap-1.5">
                <span
                  className={cn(
                    "inline-block h-1.5 w-1.5 rounded-full shrink-0",
                    cfg.dotClass,
                  )}
                  aria-hidden
                />
                <span className={cfg.captionClass}>
                  {cfg.label}
                  {latencyCaption ? ` · ${latencyCaption}` : ""}
                </span>
              </p>
            </label>
          </div>

          {/* Remove button — custom relays only */}
          {onRemove && (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                onRemove();
              }}
              aria-label={`Remove ${relay.name}`}
              className={cn(
                "shrink-0 mt-0.5 p-1 rounded text-gray/50 transition-colors duration-150",
                "hover:text-error hover:bg-error/10",
                "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
                "active:scale-95",
              )}
            >
              <X className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      </div>
    </li>
  );
}

// ---------------------------------------------------------------------------
// Inline add-custom form
// ---------------------------------------------------------------------------

const URL_RE = /^(https?:\/\/[^\s]+|\/[^\s]*)$/;

function AddCustomForm({
  onSubmit,
  onCancel,
}: {
  onSubmit: (name: string, url: string) => void;
  onCancel: () => void;
}) {
  const [url, setUrl] = useState("");
  const [name, setName] = useState("");
  const [urlError, setUrlError] = useState<string | null>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  // Focus the URL field when the form opens.
  useEffect(() => {
    urlInputRef.current?.focus();
  }, []);

  function validate(): boolean {
    const trimmed = url.trim();
    if (!trimmed) {
      setUrlError("URL is required.");
      return false;
    }
    if (!URL_RE.test(trimmed)) {
      setUrlError("Enter a valid https:// URL or a relative /path.");
      return false;
    }
    setUrlError(null);
    return true;
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!validate()) return;
    const finalName = name.trim() || url.trim();
    onSubmit(finalName, url.trim());
  }

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "rounded-md border border-gray/10 bg-muted/10 px-3 py-3 space-y-2",
        "transition-all duration-200 motion-reduce:transition-none",
      )}
      aria-label="Add custom relay"
      noValidate
    >
      <p className="text-[11px] font-semibold text-gray-light uppercase tracking-[0.14em]">
        Add custom relay
      </p>

      {/* URL field */}
      <div className="space-y-1">
        <input
          ref={urlInputRef}
          type="url"
          value={url}
          onChange={(e) => {
            setUrl(e.target.value);
            if (urlError) setUrlError(null);
          }}
          placeholder="https://your-relay.example.com"
          aria-label="Relay URL"
          aria-invalid={!!urlError}
          aria-describedby={urlError ? "relay-url-error" : undefined}
          required
          className={cn(
            "w-full px-3 py-1.5 rounded-md bg-muted/40",
            "border text-[12px] font-mono outline-none",
            "transition-colors duration-150 motion-reduce:transition-none",
            "placeholder:text-gray/50",
            urlError
              ? "border-error/40 focus:border-error/60 text-foreground"
              : "border-gray/10 focus:border-privacy/40 focus:bg-muted/60 text-foreground",
          )}
        />
        {urlError && (
          <p id="relay-url-error" role="alert" className="text-[11px] text-error font-mono">
            {urlError}
          </p>
        )}
      </div>

      {/* Name field (optional) */}
      <input
        type="text"
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Display name (optional)"
        aria-label="Relay display name (optional)"
        className={cn(
          "w-full px-3 py-1.5 rounded-md bg-muted/40 border border-gray/10",
          "text-[12px] font-mono outline-none",
          "transition-colors duration-150 motion-reduce:transition-none",
          "placeholder:text-gray/50 text-foreground",
          "focus:border-privacy/40 focus:bg-muted/60",
        )}
      />

      {/* Actions */}
      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="submit"
          className={cn(
            "px-3 py-1.5 text-[11px] font-medium rounded-md transition-all duration-150 motion-reduce:transition-none",
            "bg-foreground text-background hover:bg-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background",
            "active:scale-[0.98]",
          )}
        >
          Add relay
        </button>
        <button
          type="button"
          onClick={onCancel}
          className={cn(
            "px-2 py-1.5 text-[11px] text-gray hover:text-foreground transition-colors duration-150",
            "focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring rounded",
          )}
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
