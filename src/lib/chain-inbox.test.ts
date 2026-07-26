import { beforeEach, describe, expect, it, mock } from "bun:test";
import { getNetworkConfig } from "./network-config";
import {
  auditorCiphertextFromSuiFields,
  fetchInboxSource,
  parseAuditorCiphertextSegments,
} from "./chain-inbox";

const mockFetch = mock(() => Promise.resolve({} as Response));
global.fetch = mockFetch as any;

beforeEach(() => {
  mockFetch.mockReset();
});

// ---------------------------------------------------------------------------
// parseAuditorCiphertextSegments — Solana disc-0x16 sol_log_data parser
// ---------------------------------------------------------------------------

describe("parseAuditorCiphertextSegments", () => {
  const commitment = new Uint8Array(32).fill(0xaa);
  const blob = new Uint8Array(112).fill(0xbb);

  function makeSegments(): Uint8Array[] {
    return [
      Uint8Array.from([0x16]), // disc
      commitment,
      blob,
    ];
  }

  it("parses valid segments and returns commitment + blob", () => {
    const result = parseAuditorCiphertextSegments(makeSegments());
    expect(result).not.toBeNull();
    expect(result!.commitment).toEqual(commitment);
    expect(result!.blob).toEqual(blob);
  });

  it("returns null when fewer than 3 segments", () => {
    expect(parseAuditorCiphertextSegments([Uint8Array.from([0x16]), commitment])).toBeNull();
    expect(parseAuditorCiphertextSegments([])).toBeNull();
  });

  it("returns null when discriminator byte is wrong", () => {
    const segs = makeSegments();
    segs[0] = Uint8Array.from([0x03]); // stealth announcement disc, not 0x16
    expect(parseAuditorCiphertextSegments(segs)).toBeNull();
  });

  it("returns null when commitment is not 32 bytes", () => {
    const segs = makeSegments();
    segs[1] = new Uint8Array(31);
    expect(parseAuditorCiphertextSegments(segs)).toBeNull();
  });

  it("returns null when blob is not 112 bytes", () => {
    const segs = makeSegments();
    segs[2] = new Uint8Array(111);
    expect(parseAuditorCiphertextSegments(segs)).toBeNull();
  });
});

describe("fetchInboxSource", () => {
  it("routes Solana announcements through the active network proxy", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        success: true,
        announcements: [{
          leaf_index: 7,
          announcement_type: 0,
          ephemeral_pub: "11".repeat(32),
          encrypted_amount: "22".repeat(8),
          commitment: "33".repeat(32),
          token_id: "44".repeat(32),
          block_time: 1_700_000_000,
          slot: 123,
        }],
      }),
    } as any);

    const source = await fetchInboxSource({
      networkId: "devnet-regtest",
      vaultId: "open",
      config: getNetworkConfig("devnet-regtest", { applyEnvOverrides: false }),
    });

    expect(mockFetch.mock.calls[0][0]).toBe(
      "/api/announcements?network=devnet-regtest&vault=open",
    );
    expect(source.announcements).toHaveLength(1);
    expect(source.announcements[0].leafIndex).toBe(7);
    expect(source.announcements[0].blockTime).toBe(1_700_000_000);
    expect(source.announcements[0].slot).toBe(123);
  });
});

// ---------------------------------------------------------------------------
// auditorCiphertextFromSuiFields — Sui field extractor
// ---------------------------------------------------------------------------

describe("auditorCiphertextFromSuiFields", () => {
  const commitment = Array.from({ length: 32 }, (_, i) => i);
  const blob = Array.from({ length: 112 }, (_, i) => i % 256);

  it("extracts commitment and blob from a valid Sui event payload", () => {
    const payload = { commitment, auditor_ciphertext: blob };
    const result = auditorCiphertextFromSuiFields(payload, 1_700_000_000);
    expect(result).not.toBeNull();
    expect(result!.commitment).toEqual(Uint8Array.from(commitment));
    expect(result!.blob).toEqual(Uint8Array.from(blob));
    expect(result!.blockTime).toBe(1_700_000_000);
  });

  it("returns null when auditor_ciphertext field is absent", () => {
    const payload = { commitment };
    expect(auditorCiphertextFromSuiFields(payload)).toBeNull();
  });

  it("returns null when auditor_ciphertext is an empty array (public-pool case)", () => {
    const payload = { commitment, auditor_ciphertext: [] };
    expect(auditorCiphertextFromSuiFields(payload)).toBeNull();
  });

  it("returns null when blob length is not 112 bytes", () => {
    const shortBlob = Array.from({ length: 64 }, () => 0);
    const payload = { commitment, auditor_ciphertext: shortBlob };
    expect(auditorCiphertextFromSuiFields(payload)).toBeNull();
  });

  it("returns null when commitment is missing", () => {
    const payload = { auditor_ciphertext: blob };
    expect(auditorCiphertextFromSuiFields(payload)).toBeNull();
  });
});
