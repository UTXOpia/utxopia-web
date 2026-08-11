import type { ChainId } from "@/lib/chain-registry";
import type { NetworkId } from "@/lib/network-config";

// Letters and digits only. SNS itself permits hyphens, but a private receive
// name is read aloud, retyped from a screenshot and pasted into a send box —
// and a hyphen in a name that already ends `.utxopia.sol` is one more thing to
// get wrong for no gain. It also stops a lookalike of an existing handle being
// claimed by inserting a dash.
const SOL_HANDLE_RE = /^[a-z0-9]{1,32}$/;

/** The one spelling of the private-name suffix. Every surface imports this. */
export const PRIVATE_NAME_SUFFIX = ".utxopia.sol";

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
  const handle = withoutAt.endsWith(PRIVATE_NAME_SUFFIX)
    ? withoutAt.slice(0, -1 * PRIVATE_NAME_SUFFIX.length)
    : withoutAt;
  if (!SOL_HANDLE_RE.test(handle)) {
    throw new Error("Choose a name with lowercase letters and numbers only — no hyphens or spaces.");
  }
  return handle;
}

export function formatPrivateReceiveName(handleOrName: string, chain: ChainId) {
  const handle = normalizePrivateNameHandle(handleOrName, chain);
  return `${handle}${PRIVATE_NAME_SUFFIX}`;
}

export async function claimPrivateReceiveName(input: ClaimPrivateReceiveNameInput): Promise<PrivateNameClaimResult> {
  const handle = normalizePrivateNameHandle(input.name, input.chain);
  if (!input.solanaClaim) throw new Error("Solana name claim function is not configured.");
  const ok = await input.solanaClaim(handle);
  if (!ok) throw new Error("Could not claim Solana private name.");
  return { normalizedName: formatPrivateReceiveName(handle, "solana") };
}
