export type MagicBlockExecutionMode = "solana" | "er" | "per";
export type MagicBlockValidatorRegion = "asia" | "eu" | "us" | "tee" | "local";
export type PrivacyDomain = "public" | "institution";

export interface MagicBlockClientConfig {
  executionMode: MagicBlockExecutionMode;
  privacyDomain: PrivacyDomain;
  routerUrl: string;
  routerWsUrl: string;
  validatorRegion: MagicBlockValidatorRegion;
  erUrl?: string;
  perUrl?: string;
  /** Server-only token obtained through MagicBlock's signed PER authentication flow. */
  perAuthToken?: string;
}

const EXECUTION_MODES = new Set<MagicBlockExecutionMode>(["solana", "er", "per"]);
const VALIDATOR_REGIONS = new Set<MagicBlockValidatorRegion>(["asia", "eu", "us", "tee", "local"]);
const PRIVACY_DOMAINS = new Set<PrivacyDomain>(["public", "institution"]);

export const MAGICBLOCK_DEVNET_ROUTER_URL = "https://devnet-router.magicblock.app";
export const MAGICBLOCK_DEVNET_ROUTER_WS_URL = "wss://devnet-router.magicblock.app";

export function normalizeExecutionMode(value: string | undefined): MagicBlockExecutionMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized && EXECUTION_MODES.has(normalized as MagicBlockExecutionMode)) {
    return normalized as MagicBlockExecutionMode;
  }
  return "solana";
}

export function normalizePrivacyDomain(value: string | undefined): PrivacyDomain {
  const normalized = value?.trim().toLowerCase();
  if (normalized && PRIVACY_DOMAINS.has(normalized as PrivacyDomain)) {
    return normalized as PrivacyDomain;
  }
  return "public";
}

export function normalizeValidatorRegion(
  value: string | undefined,
  executionMode: MagicBlockExecutionMode
): MagicBlockValidatorRegion {
  const normalized = value?.trim().toLowerCase();
  if (normalized && VALIDATOR_REGIONS.has(normalized as MagicBlockValidatorRegion)) {
    return normalized as MagicBlockValidatorRegion;
  }
  return executionMode === "per" ? "tee" : "asia";
}

function optionalUrl(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function getMagicBlockClientConfig(env: NodeJS.ProcessEnv = process.env): MagicBlockClientConfig {
  const executionMode = normalizeExecutionMode(env.NEXT_PUBLIC_UTXOPIA_EXECUTION_MODE);
  return {
    executionMode,
    privacyDomain: normalizePrivacyDomain(env.NEXT_PUBLIC_UTXOPIA_PRIVACY_DOMAIN),
    routerUrl: optionalUrl(env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_URL) ?? MAGICBLOCK_DEVNET_ROUTER_URL,
    routerWsUrl: optionalUrl(env.NEXT_PUBLIC_MAGICBLOCK_ROUTER_WS_URL) ?? MAGICBLOCK_DEVNET_ROUTER_WS_URL,
    validatorRegion: normalizeValidatorRegion(
      env.NEXT_PUBLIC_MAGICBLOCK_VALIDATOR_REGION,
      executionMode
    ),
    erUrl: optionalUrl(env.NEXT_PUBLIC_MAGICBLOCK_ER_URL),
    perUrl: optionalUrl(env.NEXT_PUBLIC_MAGICBLOCK_PER_URL),
    perAuthToken: optionalUrl(env.MAGICBLOCK_PER_AUTH_TOKEN),
  };
}

export function assertMagicBlockClientConfig(config: MagicBlockClientConfig): void {
  if (config.executionMode === "er" && !config.erUrl) {
    throw new Error("NEXT_PUBLIC_MAGICBLOCK_ER_URL is required when execution mode is ER");
  }
  if (config.executionMode === "per" && !config.perUrl) {
    throw new Error("NEXT_PUBLIC_MAGICBLOCK_PER_URL is required when execution mode is PER");
  }
  if (config.executionMode === "per" && config.privacyDomain === "public") {
    throw new Error("PER execution requires a non-public privacy domain");
  }
  if (config.executionMode === "per" && config.validatorRegion !== "tee") {
    throw new Error("PER execution requires the TEE validator region");
  }
  if (config.executionMode === "per" && !config.perAuthToken) {
    throw new Error("MAGICBLOCK_PER_AUTH_TOKEN is required when execution mode is PER");
  }
}
