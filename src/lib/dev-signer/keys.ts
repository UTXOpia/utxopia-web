// web/src/lib/dev-signer/keys.ts
export const DEV_KEYS_STORAGE_KEY = "__UTXOPIA_DEV_KEYS";

export interface DevKeys {
  solanaSecretKeyB58: string;
  btcWif: string;
  utxopiaSeedHex: string;
}

function isComplete(k: Partial<DevKeys> | undefined | null): k is DevKeys {
  return !!(k?.solanaSecretKeyB58 && k.btcWif && k.utxopiaSeedHex);
}

/** Load dev keys from (1) globalThis injection, (2) localStorage, then
 *  (3) NEXT_PUBLIC_* env vars. localStorage survives reloads, so a browser
 *  agent can set it once and the keys persist past the navigation needed to
 *  mount the dev signer. Every source requires all three fields. */
export function loadDevKeys(): DevKeys | null {
  const injected = (globalThis as Record<string, unknown>).__UTXOPIA_DEV_KEYS as
    | DevKeys
    | undefined;
  if (isComplete(injected)) return injected;

  if (typeof localStorage !== "undefined") {
    try {
      const raw = localStorage.getItem(DEV_KEYS_STORAGE_KEY);
      if (raw) {
        const stored = JSON.parse(raw) as Partial<DevKeys>;
        if (isComplete(stored)) return stored;
      }
    } catch {
      // malformed JSON / unavailable storage — fall through to env
    }
  }

  const sol = process.env.NEXT_PUBLIC_DEV_SOLANA_SK;
  const btc = process.env.NEXT_PUBLIC_DEV_BTC_WIF;
  const seed = process.env.NEXT_PUBLIC_DEV_UTXOPIA_SEED;
  if (sol && btc && seed) {
    return { solanaSecretKeyB58: sol, btcWif: btc, utxopiaSeedHex: seed };
  }
  return null;
}
