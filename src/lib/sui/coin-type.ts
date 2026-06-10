/**
 * Canonicalize a Sui coin type for token-id derivation.
 *
 * The Move `bound_params::sui_token_id<T>()` hashes `type_name::get<T>()`, whose
 * address part is the full 32-byte hex **without** a `0x` prefix and zero-padded
 * to 64 chars. RPC/registry results carry the `0x`-prefixed form, so passing them
 * straight into `deriveSuiTokenId` yields a different id than the on-chain one.
 * Normalize here so SDK-derived token ids match the contract.
 */
export function canonicalSuiCoinType(coinType: string): string {
  const [addr, ...rest] = coinType.split("::");
  const norm = addr.replace(/^0x/i, "").toLowerCase().padStart(64, "0");
  return [norm, ...rest].join("::");
}
