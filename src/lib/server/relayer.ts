import { Keypair } from "@solana/web3.js";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

/**
 * Load the relayer keypair from RELAYER_KEYPAIR or RELAYER_KEYPAIR_PATH.
 * Returns null if the env var is missing or malformed.
 */
export function getRelayerKeypair(): Keypair | null {
  const keypairJson = process.env.RELAYER_KEYPAIR || readRelayerKeypairFile();
  if (!keypairJson) {
    return null;
  }
  try {
    const secretKey = JSON.parse(keypairJson);
    return Keypair.fromSecretKey(Uint8Array.from(secretKey));
  } catch {
    return null;
  }
}

function readRelayerKeypairFile(): string | null {
  const keypairPath = process.env.RELAYER_KEYPAIR_PATH;
  if (!keypairPath) return null;
  try {
    const resolvedPath = keypairPath.startsWith("~/")
      ? `${homedir()}${keypairPath.slice(1)}`
      : keypairPath;
    return readFileSync(resolvedPath, "utf8");
  } catch {
    return null;
  }
}
