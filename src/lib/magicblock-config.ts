export type MagicBlockPolicyMode = "disabled" | "per";
export type PrivacyDomain = "public" | "institution";

/**
 * MagicBlock is a private policy/coordination coprocessor.
 *
 * Asset execution is intentionally not configurable here: commitments,
 * nullifiers, Merkle trees, deposits, transfers, and withdrawals settle on
 * Solana.
 */
export interface MagicBlockPolicyConfig {
  policyMode: MagicBlockPolicyMode;
  privacyDomain: PrivacyDomain;
}

const POLICY_MODES = new Set<MagicBlockPolicyMode>(["disabled", "per"]);
const PRIVACY_DOMAINS = new Set<PrivacyDomain>(["public", "institution"]);

export function normalizePolicyMode(value: string | undefined): MagicBlockPolicyMode {
  const normalized = value?.trim().toLowerCase();
  if (normalized && POLICY_MODES.has(normalized as MagicBlockPolicyMode)) {
    return normalized as MagicBlockPolicyMode;
  }
  return "disabled";
}

export function normalizePrivacyDomain(value: string | undefined): PrivacyDomain {
  const normalized = value?.trim().toLowerCase();
  if (normalized && PRIVACY_DOMAINS.has(normalized as PrivacyDomain)) {
    return normalized as PrivacyDomain;
  }
  return "public";
}

export function getMagicBlockPolicyConfig(
  env: NodeJS.ProcessEnv = process.env
): MagicBlockPolicyConfig {
  return {
    policyMode: normalizePolicyMode(env.MAGICBLOCK_POLICY_MODE),
    privacyDomain: normalizePrivacyDomain(env.NEXT_PUBLIC_UTXOPIA_PRIVACY_DOMAIN),
  };
}

export function assertMagicBlockPolicyConfig(config: MagicBlockPolicyConfig): void {
  if (config.policyMode === "disabled") {
    return;
  }
  if (config.privacyDomain !== "institution") {
    throw new Error("PER policy requires the institution privacy domain");
  }
}
