import { PublicKey } from "@solana/web3.js";
import { parseSnsStealthData, sha256Hash, type SnsStealthAddress } from "@utxopia/sdk";
import type { NetworkConfig } from "@/lib/network-config";

export const SNS_HASH_PREFIX = "SPL Name Service";
export const SNS_HEADER_SIZE = 96;

export type SnsNetworkConfig = NonNullable<NetworkConfig["sns"]>;

export function getSnsConfig(config: NetworkConfig): SnsNetworkConfig | null {
  const sns = config.sns;
  if (
    !sns?.nameServiceProgramId ||
    !sns.registrarProgramId ||
    !sns.subRegistrarProgramId ||
    !sns.rootDomain ||
    !sns.parentDomain ||
    !sns.reverseLookupClass
  ) {
    return null;
  }
  return sns;
}

export function hashSnsName(name: string): Uint8Array {
  return sha256Hash(new TextEncoder().encode(SNS_HASH_PREFIX + name));
}

export function deriveParentDomainKey(sns: SnsNetworkConfig): PublicKey {
  const hashedParent = hashSnsName(sns.parentDomain);
  const rootDomain = new PublicKey(sns.rootDomain);
  const nameServiceProgramId = new PublicKey(sns.nameServiceProgramId);
  const [parentKey] = PublicKey.findProgramAddressSync(
    [hashedParent, new Uint8Array(32), rootDomain.toBytes()],
    nameServiceProgramId,
  );
  return parentKey;
}

export function deriveSubdomainKey(subdomain: string, parentKey: PublicKey, sns: SnsNetworkConfig): PublicKey {
  const hashedSub = hashSnsName("\0" + subdomain);
  const nameServiceProgramId = new PublicKey(sns.nameServiceProgramId);
  const [subdomainKey] = PublicKey.findProgramAddressSync(
    [hashedSub, new Uint8Array(32), parentKey.toBytes()],
    nameServiceProgramId,
  );
  return subdomainKey;
}

export function deriveReverseLookupKey(subdomainKey: PublicKey, parentKey: PublicKey, sns: SnsNetworkConfig): PublicKey {
  const reverseLookupClass = new PublicKey(sns.reverseLookupClass);
  const nameServiceProgramId = new PublicKey(sns.nameServiceProgramId);
  const reverseHash = hashSnsName(subdomainKey.toBase58());
  const [reverseKey] = PublicKey.findProgramAddressSync(
    [reverseHash, reverseLookupClass.toBytes(), parentKey.toBytes()],
    nameServiceProgramId,
  );
  return reverseKey;
}

export function normalizeSnsSubdomain(name: string, sns: SnsNetworkConfig): string | null {
  let subdomain = name.trim().toLowerCase();
  if (subdomain.endsWith(".sol")) {
    subdomain = subdomain.slice(0, -4);
  }
  if (subdomain.endsWith(`.${sns.parentDomain}`)) {
    subdomain = subdomain.slice(0, -(sns.parentDomain.length + 1));
  }
  if (!subdomain || subdomain.includes(".")) return null;
  return subdomain;
}

export async function resolveSnsNameForNetwork(
  connection: { getAccountInfo: (key: PublicKey) => Promise<{ data: Uint8Array | Buffer } | null> },
  name: string,
  sns: SnsNetworkConfig,
): Promise<SnsStealthAddress | null> {
  const subdomain = normalizeSnsSubdomain(name, sns);
  if (!subdomain) return null;

  const parentKey = deriveParentDomainKey(sns);
  const subdomainKey = deriveSubdomainKey(subdomain, parentKey, sns);
  const accountInfo = await connection.getAccountInfo(subdomainKey);
  if (!accountInfo) return null;

  const parsed = parseSnsStealthData(new Uint8Array(accountInfo.data));
  if (!parsed) return null;

  return {
    name: subdomain,
    fullDomain: `${subdomain}.${sns.parentDomain}.sol`,
    viewingPubKey: parsed.viewingPubKey,
    mpk: parsed.mpk,
    version: parsed.version,
    complianceFlags: parsed.complianceFlags,
    auditorPubkey: parsed.auditorPubkey,
  };
}

export async function isSnsSubdomainRegistered(
  connection: { getAccountInfo: (key: PublicKey) => Promise<unknown | null> },
  name: string,
  sns: SnsNetworkConfig,
): Promise<boolean> {
  const subdomain = normalizeSnsSubdomain(name, sns);
  if (!subdomain) return false;

  const parentKey = deriveParentDomainKey(sns);
  const subdomainKey = deriveSubdomainKey(subdomain, parentKey, sns);
  return Boolean(await connection.getAccountInfo(subdomainKey));
}

export function parseSnsReverseName(data: Uint8Array | Buffer): string | null {
  if (data.length <= SNS_HEADER_SIZE + 4) return null;
  const bytes = Buffer.from(data);
  const nameLen = bytes.readUInt32LE(SNS_HEADER_SIZE);
  const start = SNS_HEADER_SIZE + 4;
  const end = start + nameLen;
  if (nameLen <= 0 || end > bytes.length) return null;
  const name = bytes.subarray(start, end).toString("utf8").replace(/\0/g, "").trim();
  return name || null;
}
