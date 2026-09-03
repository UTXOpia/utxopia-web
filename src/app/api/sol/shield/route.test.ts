import { describe, expect, it } from "bun:test";
import { ComputeBudgetProgram, Keypair, PublicKey, SystemProgram, Transaction, TransactionInstruction } from "@solana/web3.js";
import { validateSponsoredTx } from "@/lib/server/sponsored-shield";

const relayer = Keypair.generate();
const user = Keypair.generate();
const program = Keypair.generate().publicKey;
const blockhash = "EETubP5AKHgjPAhzPAFcb8BAY1hMH639CWCFTqi3hq1k";

function shieldIx(disc = 12) {
  return new TransactionInstruction({
    programId: program,
    data: Buffer.from([disc, 1, 2, 3]),
    keys: [{ pubkey: user.publicKey, isSigner: true, isWritable: true }],
  });
}
function signed(...ixs: TransactionInstruction[]) {
  const tx = new Transaction({ feePayer: relayer.publicKey, recentBlockhash: blockhash }).add(...ixs);
  tx.partialSign(user);
  return tx;
}

describe("validateSponsoredTx", () => {
  it("accepts a user-signed shield with the relayer as fee payer", () => {
    expect(validateSponsoredTx(signed(shieldIx()), relayer.publicKey, program)).toBeNull();
  });
  it("refuses anything that could spend the relayer's lamports", () => {
    const drain = SystemProgram.transfer({ fromPubkey: relayer.publicKey, toPubkey: user.publicKey, lamports: 1 });
    const tx = new Transaction({ feePayer: relayer.publicKey, recentBlockhash: blockhash }).add(shieldIx(), drain);
    tx.partialSign(user);
    expect(validateSponsoredTx(tx, relayer.publicKey, program)).toMatch(/relayer referenced/);
    const price = ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 1 });
    expect(validateSponsoredTx(signed(price, shieldIx()), relayer.publicKey, program)).toMatch(/priority fee/);
    expect(validateSponsoredTx(signed(shieldIx(13)), relayer.publicKey, program)).toMatch(/only shield/);
    const unsigned = new Transaction({ feePayer: relayer.publicKey, recentBlockhash: blockhash }).add(shieldIx());
    expect(validateSponsoredTx(unsigned, relayer.publicKey, program)).toMatch(/signature missing/);
    const other = new Transaction({ feePayer: user.publicKey, recentBlockhash: blockhash }).add(shieldIx());
    expect(validateSponsoredTx(other, relayer.publicKey, program)).toMatch(/fee payer/);
    const foreign = new TransactionInstruction({ programId: new PublicKey(Keypair.generate().publicKey), data: Buffer.alloc(1), keys: [] });
    expect(validateSponsoredTx(signed(shieldIx(), foreign), relayer.publicKey, program)).toMatch(/not allowed/);
  });
});
