const BACKEND_API_KEY_ENV_NAMES = [
  "BACKEND_API_KEY",
  "REGTEST_FAUCET_BACKEND_API_KEY",
  "UTXOPIA_BACKEND_API_KEY",
] as const;

export function getBackendApiKey(): string {
  for (const name of BACKEND_API_KEY_ENV_NAMES) {
    const value = process.env[name]?.trim();
    if (value) return value;
  }
  return "";
}

export function applyBackendAuthHeaders(headers: Record<string, string>): Record<string, string> {
  const key = getBackendApiKey();
  if (key) headers["X-API-Key"] = key;
  return headers;
}

