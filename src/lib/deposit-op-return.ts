import { PublicKey } from "@solana/web3.js";
import { sha256 } from "@noble/hashes/sha2.js";
import type { NetworkConfig } from "@/lib/network-config";

const TEXT_ENCODER = new TextEncoder();
const DEPOSIT_OP_RETURN_SIZE = 73;
const DEPOSIT_POOL_TAG_SIZE = 8;
const DEPOSIT_DESTINATION_CHAIN = {
  SOLANA: 1,
  SUI: 2,
} as const;
const DEPOSIT_BITCOIN_NETWORK = {
  MAINNET: 0,
  TESTNET4: 2,
  REGTEST: 3,
} as const;

type DepositBitcoinNetwork =
  (typeof DEPOSIT_BITCOIN_NETWORK)[keyof typeof DEPOSIT_BITCOIN_NETWORK];

export interface DepositOpReturnContext {
  destinationChain: (typeof DEPOSIT_DESTINATION_CHAIN)[keyof typeof DEPOSIT_DESTINATION_CHAIN];
  bitcoinNetwork: DepositBitcoinNetwork;
  poolTag: Uint8Array;
}

export function depositOpReturnContextForNetworkConfig(cfg: NetworkConfig): DepositOpReturnContext {
  return cfg.chain === "sui"
    ? suiDepositOpReturnContext(cfg)
    : solanaDepositOpReturnContext(cfg);
}

export function parseDepositOpReturnHex(opReturnHex: string): {
  ephemeralPubHex: string;
  npkHex: string;
} {
  const payload = hexToBytes(opReturnHex);
  if (payload.length !== DEPOSIT_OP_RETURN_SIZE || !isValidDepositHeader(payload[0])) {
    throw new Error("invalid deposit OP_RETURN payload");
  }
  return {
    ephemeralPubHex: bytesToHex(payload.slice(1 + DEPOSIT_POOL_TAG_SIZE, 1 + DEPOSIT_POOL_TAG_SIZE + 32)),
    npkHex: bytesToHex(payload.slice(1 + DEPOSIT_POOL_TAG_SIZE + 32, DEPOSIT_OP_RETURN_SIZE)),
  };
}

function solanaDepositOpReturnContext(cfg: NetworkConfig): DepositOpReturnContext {
  const programId = new PublicKey(cfg.solana.utxopiaProgramId);
  const [poolStatePda] = PublicKey.findProgramAddressSync([Buffer.from("pool_state")], programId);
  const zkbtcMint = new PublicKey(cfg.tokens.zkbtcMint);

  return {
    destinationChain: DEPOSIT_DESTINATION_CHAIN.SOLANA,
    bitcoinNetwork: bitcoinNetworkToDepositNetwork(cfg.bitcoin.network),
    poolTag: computeDepositPoolTag([
      TEXT_ENCODER.encode("UTXOPIA_SOL"),
      programId.toBytes(),
      poolStatePda.toBytes(),
      zkbtcMint.toBytes(),
    ]),
  };
}

function suiDepositOpReturnContext(cfg: NetworkConfig): DepositOpReturnContext {
  const poolId = cfg.sui?.pool?.objectId;
  const treeId = cfg.sui?.commitmentTree?.objectId;
  if (!poolId || !treeId) {
    throw new Error("Sui deposit OP_RETURN context requires pool and commitmentTree object IDs");
  }

  return {
    destinationChain: DEPOSIT_DESTINATION_CHAIN.SUI,
    bitcoinNetwork: bitcoinNetworkToDepositNetwork(cfg.bitcoin.network),
    poolTag: computeDepositPoolTag([
      TEXT_ENCODER.encode("UTXOPIA_SUI"),
      suiAddressToBytes(poolId),
      suiAddressToBytes(treeId),
    ]),
  };
}

function bitcoinNetworkToDepositNetwork(network: string): DepositBitcoinNetwork {
  if (network === "mainnet") return DEPOSIT_BITCOIN_NETWORK.MAINNET;
  if (network === "regtest") return DEPOSIT_BITCOIN_NETWORK.REGTEST;
  if (network === "testnet4" || network === "testnet") return DEPOSIT_BITCOIN_NETWORK.TESTNET4;
  throw new Error(`unsupported deposit Bitcoin network: ${network}`);
}

function computeDepositPoolTag(parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return sha256(bytes).slice(0, DEPOSIT_POOL_TAG_SIZE);
}

function isValidDepositHeader(header: number): boolean {
  const version = header >> 6;
  const destination = (header >> 4) & 0x03;
  const network = header & 0x0f;
  return version === 1
    && (destination === DEPOSIT_DESTINATION_CHAIN.SOLANA || destination === DEPOSIT_DESTINATION_CHAIN.SUI)
    && (network === DEPOSIT_BITCOIN_NETWORK.MAINNET
      || network === DEPOSIT_BITCOIN_NETWORK.TESTNET4
      || network === DEPOSIT_BITCOIN_NETWORK.REGTEST);
}

function suiAddressToBytes(value: string): Uint8Array {
  const hex = value.startsWith("0x") ? value.slice(2) : value;
  if (hex.length > 64) {
    throw new Error(`invalid Sui address: ${value}`);
  }
  return hexToBytes(hex.padStart(64, "0"));
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = Number.parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}
