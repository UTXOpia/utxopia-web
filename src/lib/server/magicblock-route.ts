import {
  assertMagicBlockPolicyConfig,
  type MagicBlockPolicyConfig,
} from "@/lib/magicblock-config";

/**
 * Enforce the product boundary at the web tier. The Rust backend owns PER
 * challenge authentication and PolicyApproval coordination; the web app never
 * creates a PER connection or receives its credentials.
 */
export function assertBackendCoordinatedPolicy(
  config: MagicBlockPolicyConfig
): "solana" {
  assertMagicBlockPolicyConfig(config);
  return "solana";
}
