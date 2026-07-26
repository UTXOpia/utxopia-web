import { PublicKey } from "@solana/web3.js";
import {
  computeDepositPoolTag,
  DEPOSIT_BITCOIN_NETWORK,
  DEPOSIT_DESTINATION_CHAIN,
  DEPOSIT_OP_RETURN_SIZE,
  DEPOSIT_POOL_TAG_SIZE,
  parseDepositOpReturn,
  type DepositBitcoinNetwork,
  type DepositOpReturnContext,
} from "@utxopia/sdk";
import type { NetworkConfig } from "@/lib/network-config";

const TEXT_ENCODER = new TextEncoder();

export type DepositAddressNetwork = "mainnet" | "testnet" | "regtest";

export function depositOpReturnContextForNetworkConfig(cfg: NetworkConfig): DepositOpReturnContext {
  return solanaDepositOpReturnContext(cfg);
}

export function depositAddressNetworkForNetworkConfig(cfg: NetworkConfig): DepositAddressNetwork {
  if (cfg.bitcoin.network === "mainnet") return "mainnet";
  if (cfg.bitcoin.network === "regtest") return "regtest";
  return "testnet";
}

export function parseDepositOpReturnHex(opReturnHex: string): {
  ephemeralPubkeyHex: string;
  notePublicKeyHex: string;
} {
  const payload = hexToBytes(opReturnHex);
  const parsed = parseDepositOpReturn(payload);
  if (!parsed) {
    throw new Error("invalid deposit OP_RETURN payload");
  }
  return {
    ephemeralPubkeyHex: bytesToHex(parsed.ephemeralPubkey),
    notePublicKeyHex: bytesToHex(parsed.notePublicKey),
  };
}

function solanaDepositOpReturnContext(cfg: NetworkConfig): DepositOpReturnContext {
  const programId = new PublicKey(cfg.solana.utxopiaProgramId);
  const zkbtcMint = new PublicKey(cfg.tokens.zkbtcMint);
  const [poolStatePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("pool_state"), zkbtcMint.toBuffer()],
    programId
  );

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

function bitcoinNetworkToDepositNetwork(network: string): DepositBitcoinNetwork {
  if (network === "mainnet") return DEPOSIT_BITCOIN_NETWORK.MAINNET;
  if (network === "regtest") return DEPOSIT_BITCOIN_NETWORK.REGTEST;
  if (network === "testnet4" || network === "testnet") return DEPOSIT_BITCOIN_NETWORK.TESTNET4;
  throw new Error(`unsupported deposit Bitcoin network: ${network}`);
}

function hexToBytes(hex: string): Uint8Array {
  if (hex.length % 2 !== 0) {
    throw new Error("hex string must have even length");
  }
  if (!/^[0-9a-fA-F]*$/.test(hex)) {
    throw new Error("hex string contains non-hex characters");
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
