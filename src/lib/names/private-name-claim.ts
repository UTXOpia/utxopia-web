import type { ChainId } from "@/lib/chain-registry";
import type { NetworkId } from "@/lib/network-config";

const SOL_HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;

export type PrivateNameClaimResult = {
  normalizedName: string;
  digest?: string | null;
};

export type ClaimPrivateReceiveNameInput = {
  chain: ChainId;
  name: string;
  networkId: NetworkId;
  solanaClaim?: (handle: string) => Promise<boolean>;
};

export function normalizePrivateNameHandle(input: string, _chain: ChainId) {
  const trimmed = input.trim().toLowerCase();
  const withoutAt = trimmed.startsWith("@") ? trimmed.slice(1) : trimmed;
  const suffix = ".utxopia.sol";
  const handle = withoutAt.endsWith(suffix)
    ? withoutAt.slice(0, -1 * suffix.length)
    : withoutAt;
  if (!SOL_HANDLE_RE.test(handle)) {
    throw new Error("Choose a Solana name with lowercase letters, numbers, or hyphens.");
  }
  return handle;
}

export function formatPrivateReceiveName(handleOrName: string, chain: ChainId) {
  const handle = normalizePrivateNameHandle(handleOrName, chain);
  return `${handle}.utxopia.sol`;
}

export async function claimPrivateReceiveName(input: ClaimPrivateReceiveNameInput): Promise<PrivateNameClaimResult> {
  const handle = normalizePrivateNameHandle(input.name, input.chain);
  if (!input.solanaClaim) throw new Error("Solana name claim function is not configured.");
  const ok = await input.solanaClaim(handle);
  if (!ok) throw new Error("Could not claim Solana private name.");
  return { normalizedName: formatPrivateReceiveName(handle, "solana") };
}
