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
  return (BUILTIN_RELAYS[relayChainKey(chainId)] ?? []).map(serializableToConfig);
}

export function getBuiltinRelaysSerializable(chainId: string): SerializableRelay[] {
  return BUILTIN_RELAYS[relayChainKey(chainId)] ?? [];
}
