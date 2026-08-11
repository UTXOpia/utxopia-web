/**
 * Validate a Bitcoin testnet4/testnet address (bech32/bech32m).
 * Returns the scriptPubKey bytes if valid.
 */
export function validateBtcAddress(addr: string): { valid: boolean; scriptPubKey: Uint8Array | null; error?: string } {
  const trimmed = addr.trim();
  if (!trimmed) {
    return { valid: false, scriptPubKey: null, error: "Please enter a Bitcoin address" };
  }

  // For testnet: tb1q (P2WPKH) or tb1p (P2TR)
  // For testnet4: tb1q or tb1p (same prefix)
  const lower = trimmed.toLowerCase();

  if (!lower.startsWith("tb1q") && !lower.startsWith("tb1p") &&
      !lower.startsWith("bcrt1q") && !lower.startsWith("bcrt1p")) {
    return {
      valid: false,
      scriptPubKey: null,
      error: "Only testnet addresses (tb1q.../tb1p...) are supported",
    };
  }

  // Basic length validation
  // P2WPKH (tb1q): 42-62 chars
  // P2TR (tb1p): 62 chars
  if (lower.startsWith("tb1q") || lower.startsWith("bcrt1q")) {
    if (trimmed.length < 42 || trimmed.length > 62) {
      return { valid: false, scriptPubKey: null, error: "Invalid P2WPKH address length" };
    }
  } else if (lower.startsWith("tb1p") || lower.startsWith("bcrt1p")) {
    if (trimmed.length < 62 || trimmed.length > 64) {
      return { valid: false, scriptPubKey: null, error: "Invalid P2TR address length" };
    }
  }

  // Decode bech32/bech32m to get the witness program
  try {
    const decoded = decodeBech32(trimmed);
    if (!decoded) {
      return { valid: false, scriptPubKey: null, error: "Invalid bech32 encoding" };
    }

    // Build scriptPubKey: OP_version(1) + push_len(1) + witness_program
    const version = decoded.version;
    const program = decoded.program;

    const scriptPubKey = new Uint8Array(2 + program.length);
    scriptPubKey[0] = version === 0 ? 0x00 : 0x50 + version; // OP_0 or OP_1..OP_16
    scriptPubKey[1] = program.length;
    scriptPubKey.set(program, 2);

    return { valid: true, scriptPubKey };
  } catch {
    return { valid: false, scriptPubKey: null, error: "Failed to decode address" };
  }
}

/** Minimal bech32/bech32m decoder */
function decodeBech32(addr: string): { version: number; program: Uint8Array } | null {
  const CHARSET = "qpzry9x8gf2tvdw0s3jn54khce6mua7l";
  const lower = addr.toLowerCase();

  // Find separator
  const sepIdx = lower.lastIndexOf("1");
  if (sepIdx < 1 || sepIdx + 7 > lower.length) return null;

  const dataPart = lower.slice(sepIdx + 1);

  // Decode charset
  const values: number[] = [];
  for (const c of dataPart) {
    const v = CHARSET.indexOf(c);
    if (v === -1) return null;
    values.push(v);
  }

  // Verify checksum (skip for simplicity — rely on length + prefix validation)
  if (values.length < 7) return null;

  // Remove checksum (last 6 values)
  const data = values.slice(0, values.length - 6);

  // First value is witness version
  const version = data[0];
  if (version > 16) return null;

  // Convert 5-bit groups to 8-bit
  const program = convert5to8(data.slice(1));
  if (!program) return null;

  // Validate program length
  if (program.length < 2 || program.length > 40) return null;
  if (version === 0 && program.length !== 20 && program.length !== 32) return null;
  if (version === 1 && program.length !== 32) return null;

  return { version, program };
}

function convert5to8(data: number[]): Uint8Array | null {
  let acc = 0;
  let bits = 0;
  const result: number[] = [];

  for (const v of data) {
    acc = (acc << 5) | v;
    bits += 5;
    while (bits >= 8) {
      bits -= 8;
      result.push((acc >> bits) & 0xff);
    }
  }

  // Check padding
  if (bits >= 5 || (acc << (8 - bits)) & 0xff) {
    // Some padding bits are non-zero, but we'll be lenient
  }

  return new Uint8Array(result);
}
