/**
 * Sponsored-shield admission check. Lives outside the route file because Next.js only
 * allows handler exports there, and this needs a unit test.
 *
 * Every check exists because dropping it lets a caller drain the relayer.
 */
import { PublicKey, Transaction } from "@solana/web3.js";
import { ASSOCIATED_TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from "@solana/spl-token";

const SYSTEM_PROGRAM = new PublicKey("11111111111111111111111111111111");
const COMPUTE_BUDGET = new PublicKey("ComputeBudget111111111111111111111111111111");
const SHIELD_DISCS = new Set([12, 23]);
/** ComputeBudget SetComputeUnitPrice: a priority fee the relayer would pay. Refused outright. */
const SET_CU_PRICE = 3;
const MAX_INSTRUCTIONS = 6;

/** Returns an error string, or null when the transaction is safe for the relayer to co-sign. */
export function validateSponsoredTx(tx: Transaction, relayer: PublicKey, utxopiaProgram: PublicKey): string | null {
  if (!tx.feePayer?.equals(relayer)) return "fee payer must be the relayer";
  if (tx.instructions.length === 0 || tx.instructions.length > MAX_INSTRUCTIONS) return "bad instruction count";
  const allowed = new Set(
    [SYSTEM_PROGRAM, COMPUTE_BUDGET, TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, utxopiaProgram]
      .map((k) => k.toBase58()),
  );
  let shields = 0;
  for (const ix of tx.instructions) {
    if (!allowed.has(ix.programId.toBase58())) return `program not allowed: ${ix.programId.toBase58()}`;
    // The relayer may appear nowhere but as fee payer: no instruction can touch its lamports or sign for it.
    if (ix.keys.some((k) => k.pubkey.equals(relayer))) return "relayer referenced by an instruction";
    if (ix.programId.equals(COMPUTE_BUDGET) && ix.data[0] === SET_CU_PRICE) return "priority fee not sponsored";
    if (ix.programId.equals(utxopiaProgram)) {
      if (!SHIELD_DISCS.has(ix.data[0])) return "only shield instructions are sponsored";
      shields++;
    }
  }
  if (shields !== 1) return "exactly one shield instruction required";
  // Every signer the instructions name, other than the relayer, must already have signed.
  // `tx.signatures` is empty until someone signs, so derive the requirement from the keys.
  const signedBy = new Set(tx.signatures.filter((s) => s.signature !== null).map((s) => s.publicKey.toBase58()));
  for (const ix of tx.instructions) {
    for (const k of ix.keys) {
      if (k.isSigner && !signedBy.has(k.pubkey.toBase58())) return "user signature missing";
    }
  }
  if (!tx.verifySignatures(false)) return "invalid user signature";
  return null;
}
