/**
 * Turn an Anchor custom program error into something a member can act on.
 *
 * A rejected instruction reaches the UI as `custom program error: 0x1774`, and
 * that is what the beta dry run put in front of a tester: a hex number, no
 * indication of whether their money moved, and nothing to do next. The codes
 * are stable and documented — `solana-programs/programs/utxopia/src/error.rs`
 * is the source of truth — so there is no excuse for showing the raw form.
 *
 * Deliberately partial. Only the codes a *member* can reach are given plain
 * sentences; the rest fall through to their enum name plus the decimal code,
 * which is still infinitely more useful in a bug report than `0x1774` and
 * cannot lie about what happened. Nothing here invents reassurance: where the
 * outcome depends on state we do not have, the message says what to check
 * rather than promising the funds are safe.
 */

/** Codes a member can hit through ordinary use. Text is what they read. */
const MEMBER_FACING: Record<number, string> = {
  6000:
    "The pool is paused, so this could not go through. Nothing was submitted and your balance is unchanged. Withdrawals are paused too — this is the emergency stop, not a policy hold.",
  6001: "That amount is below this token's minimum. Nothing was submitted.",
  6002: "That amount is above this token's per-transaction maximum. Nothing was submitted.",
  6004:
    "One of the notes this spends has already been spent. That usually means this tab is working from stale state — reload the page and check your balance before trying again.",
  6005:
    "The note this spends is not in the on-chain tree yet. Nothing was submitted. If you deposited moments ago, wait for it to confirm and try again.",
  6011: "This wallet is not authorised for that action. Nothing was submitted.",
  6012: "Not enough balance in the vault for this. Nothing was submitted.",
  6020: "The pool's commitment tree is full. Nothing was submitted — please report this.",
  6030: "Not enough funds for this, including the fee. Nothing was submitted.",
  6074:
    "This deposit has already been recorded. Check your balance before sending it again — the first one may simply not be showing yet.",
  6080: "That token is not accepted by this pool right now. Nothing was submitted.",
  6081:
    "This looks like the wrong pool for that note. Check whether you are in the Open or Verified vault — a note belongs to the pool it was created in.",
  6082: "That amount is outside the range this pool accepts. Nothing was submitted.",
  6083: "This pool has reached its deposit cap. Nothing was submitted.",
  6084: "The fee attached was too small. Nothing was submitted.",
};

/** Everything else, so an unmapped rejection still names itself. */
const NAMES: Record<number, string> = {
  6003: "InvalidMerkleProof",
  6006: "InvalidCommitment",
  6007: "InvalidBtcAddress",
  6008: "RedemptionNotFound",
  6009: "RedemptionAlreadyCompleted",
  6010: "InvalidRedemptionState",
  6013: "Overflow",
  6014: "InvalidProofLength",
  6015: "AlreadyMinted",
  6016: "ZeroAmount",
  6017: "InvalidBlockHeader",
  6018: "InsufficientConfirmations",
  6019: "InvalidSpvProof",
  6021: "InvalidRoot",
  6022: "InvalidZkProof",
  6023: "ZkVerificationFailed",
  6024: "NotInitialized",
  6025: "AlreadyInitialized",
  6026: "InvalidAccountOwner",
  6027: "InvalidAccountData",
  6028: "InvalidStealthOpReturn",
  6029: "StealthDataNotFound",
  6031: "RedemptionCancelNotAllowed",
  6033: "RedemptionSpvFailed",
  6034: "RedemptionOutputNotFound",
  6060: "AccountNotWritable",
  6061: "InvalidMint",
  6063: "NotRentExempt",
  6064: "DuplicateAccounts",
  6065: "AccountClosed",
  6066: "InvalidVkRegistry",
  6067: "InvalidBoundParams",
  6068: "RedemptionTimeout",
  6069: "JoinSplitTooLarge",
  6070: "RedemptionOutputMismatch",
  6071: "DifficultyMismatch",
  6072: "TimelockNotElapsed",
  6073: "NoPendingProposal",
  6075: "InvalidUtxo",
  6076: "UtxoNotUnspent",
  6077: "PoolScriptMismatch",
  6078: "TaprootVerificationFailed",
  6085: "InvalidPDA",
};

/** The three shapes a custom error arrives in, depending on which layer threw. */
const PATTERNS = [
  /custom program error:\s*0x([0-9a-f]+)/i,
  /"?Custom"?\s*[:(]\s*(\d+)\s*\)?/,
  // Anchor's own rendering puts the name after "Error Code:" and the number
  // after "Error Number:", so keying on the former finds a word, not a code.
  /\berror number:\s*(\d+)/i,
];

export function programErrorCode(message: string): number | null {
  for (const [index, pattern] of PATTERNS.entries()) {
    const match = message.match(pattern);
    if (!match) continue;
    const code = parseInt(match[1], index === 0 ? 16 : 10);
    // Anchor's custom errors start at 6000; below that is the runtime's own
    // numbering, which means something entirely different.
    if (Number.isFinite(code) && code >= 6000) return code;
  }
  return null;
}

/** A member-readable description, or null when this is not a program error. */
export function describeProgramError(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  const code = programErrorCode(message);
  if (code === null) return null;

  const friendly = MEMBER_FACING[code];
  if (friendly) return friendly;

  const name = NAMES[code];
  return name
    ? `The pool rejected this: ${name} (error ${code}). Nothing was submitted. Please send us this message.`
    : `The pool rejected this with error ${code}. Nothing was submitted. Please send us this message.`;
}
