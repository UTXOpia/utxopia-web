import { describe, expect, it } from "bun:test";
import {
  bigintTo32Bytes,
  createTransferBoundParams,
  initPoseidon,
} from "@utxopia/sdk";
import {
  computeSolanaDomainBoundParamsHash,
  computeSolanaDomainSeparator,
} from "./solana-domain-binding";

const hex = (bytes: Uint8Array) =>
  Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");

describe("Solana domain binding", () => {
  it("matches the Rust and SDK protocol vectors", async () => {
    await initPoseidon();
    const context = {
      programId: new Uint8Array(32).fill(0x11),
      poolState: new Uint8Array(32).fill(0x22),
      kind: "public",
    } as const;
    const params = createTransferBoundParams(new Uint8Array(32), 103n);

    expect(hex(bigintTo32Bytes(computeSolanaDomainSeparator(context)))).toBe(
      "2b76ed47e643d671f5c01988008f8d4012b8abcb14fc937562a56bc957467696",
    );
    expect(hex(bigintTo32Bytes(computeSolanaDomainBoundParamsHash(params, context)))).toBe(
      "1f8e124663a84237000a031cbc25f4721756dab3f43d10e78a4ebac49d0c7fdb",
    );
  });

  it("separates public and institution proofs", async () => {
    await initPoseidon();
    const params = createTransferBoundParams(new Uint8Array(32), 103n);
    const base = {
      programId: new Uint8Array(32).fill(0x11),
      poolState: new Uint8Array(32).fill(0x22),
    };

    expect(computeSolanaDomainBoundParamsHash(params, { ...base, kind: "public" })).not.toBe(
      computeSolanaDomainBoundParamsHash(params, { ...base, kind: "institution" }),
    );
  });

  it("separates mainnet from devnet", async () => {
    await initPoseidon();
    const context = {
      programId: new Uint8Array(32).fill(0x11),
      poolState: new Uint8Array(32).fill(0x22),
      kind: "public",
    } as const;

    expect(computeSolanaDomainBoundParamsHash(
      createTransferBoundParams(new Uint8Array(32), 101n),
      context,
    )).not.toBe(computeSolanaDomainBoundParamsHash(
      createTransferBoundParams(new Uint8Array(32), 103n),
      context,
    ));
  });
});
