/**
 * Relay registry — static list of known relays per chain.
 *
 * Currently seeded with exactly one relay per chain (the Utxopia backend relayer).
 * The `getBuiltinRelays` function is the seam: swap its implementation to fetch
 * from an on-chain registry or an API once multiple relays exist.
 */

export interface RelayConfig {
  id: string;
  name: string;
  /** Returns the full relay submission URL for a given networkId. */
  url: (networkId: string, vaultId?: string) => string;
  region?: string;
  /** True for user-added custom relays (not in the static registry). */
  custom?: boolean;
}

// ---------------------------------------------------------------------------
// Serializable form — used for persistence (Zustand can't serialize functions)
// ---------------------------------------------------------------------------

export interface SerializableRelay {
  id: string;
  name: string;
  /** URL template with `{network}` placeholder, e.g. `/api/sol/relay?network={network}` */
  urlTemplate: string;
  region?: string;
  custom?: boolean;
}

export function serializableToConfig(r: SerializableRelay): RelayConfig {
  return {
    id: r.id,
    name: r.name,
    url: (networkId: string, vaultId = "open") =>
      r.urlTemplate
        .replace("{network}", encodeURIComponent(networkId))
        .replace("{vault}", encodeURIComponent(vaultId)),
    region: r.region,
    custom: r.custom,
  };
}

// ---------------------------------------------------------------------------
// Built-in relay registry (one per chain today)
// ---------------------------------------------------------------------------

const BUILTIN_RELAYS: Record<string, SerializableRelay[]> = {
  sol: [
    {
      id: "default",
      name: "Utxopia relay",
      // Reproduces: `/api/sol/relay?network=${encodeURIComponent(networkId)}`
      urlTemplate: "/api/sol/relay?network={network}&vault={vault}",
    },
  ],
};

/**
 * Ensure a relay URL carries both placeholders.
 *
 * `{vault}` is not cosmetic: a relay URL that omits it submits against the
 * Open pool whatever vault the member is actually spending from, and the
 * mismatch surfaces as a bogus rejection rather than as a wrong-pool error.
 */
export function normalizeRelayUrlTemplate(url: string): string {
  let out = url.trim();
  for (const [placeholder, param] of [["{network}", "network"], ["{vault}", "vault"]] as const) {
    if (out.includes(placeholder)) continue;
    out += `${out.includes("?") ? "&" : "?"}${param}=${placeholder}`;
  }
  return out;
}

/**
 * Deployment-configured relays, highest priority first.
 *
 * `NEXT_PUBLIC_RELAY_URLS` is a comma-separated list of `Name|URL` (the name is
 * optional). It exists so a deployment can point spends at its own relay — one
 * running beside the backend, say — without every member adding it by hand. The
 * same-origin built-in stays in the list behind these, so an unreachable
 * configured relay fails over rather than taking spends down.
 */
function envRelays(chainKey: string): SerializableRelay[] {
  if (chainKey !== "sol") return [];
  const raw = process.env.NEXT_PUBLIC_RELAY_URLS;
  if (!raw) return [];

  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry, index) => {
      const separator = entry.indexOf("|");
      const hasName = separator > 0;
      const name = hasName ? entry.slice(0, separator).trim() : `Configured relay ${index + 1}`;
      const url = hasName ? entry.slice(separator + 1).trim() : entry;
      return { id: `env-${index}`, name, urlTemplate: normalizeRelayUrlTemplate(url) };
    })
    .filter((relay) => relay.urlTemplate.length > 0);
}

/**
 * Normalize the app's chain id ("solana", from `config.chain`) to the
 * registry/API key ("sol"). Accepts either form so callers using either
 * convention resolve correctly.
 */
function relayChainKey(chainId: string): string {
  const c = chainId.toLowerCase();
  if (c === "solana" || c === "sol") return "sol";
  return c;
}

/**
 * Returns the built-in relay list for a chain.
 * Seam for future: replace body with a fetch from on-chain registry or remote API.
 */
export function getBuiltinRelays(chainId: string): RelayConfig[] {
  return getBuiltinRelaysSerializable(chainId).map(serializableToConfig);
}

export function getBuiltinRelaysSerializable(chainId: string): SerializableRelay[] {
  const key = relayChainKey(chainId);
  return [...envRelays(key), ...(BUILTIN_RELAYS[key] ?? [])];
}
