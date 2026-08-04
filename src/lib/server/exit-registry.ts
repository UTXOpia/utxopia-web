import { Connection, PublicKey } from "@solana/web3.js";

/**
 * The pool's exit registry, as the relay needs it.
 *
 * A withdrawal to a destination that is already registered takes the ragequit
 * path: no approval, no coordinator, no dependency on the operator being awake.
 * That is the *faster* route, not an emergency one, which is what keeps it
 * exercised — an escape hatch nobody walks is an escape hatch that rots.
 *
 * The browser-side counterpart lives in `@/lib/exit-registry`; this one runs on
 * the relay because that is where the account list is assembled.
 */
const EXIT_DESTINATION_SEED = "exit_destination";
const EXIT_KIND_SOLANA_OWNER = 0;

export function solanaExitPda(
  programId: PublicKey,
  poolState: PublicKey,
  owner: PublicKey,
): PublicKey {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from(EXIT_DESTINATION_SEED),
      poolState.toBuffer(),
      Buffer.from([EXIT_KIND_SOLANA_OWNER]),
      owner.toBuffer(),
    ],
    programId,
  )[0];
}

/**
 * The registry entries for every recipient, or `null` if any is missing.
 *
 * All-or-nothing on purpose: the program checks one entry per public output, so
 * a partially registered set cannot take this path, and quietly dropping the
 * unregistered recipient would pay the wrong person. `null` means "use the
 * approval path", which always works.
 */
export async function resolveRegisteredExits(
  connection: Connection,
  programId: PublicKey,
  poolState: PublicKey,
  recipients: PublicKey[],
): Promise<PublicKey[] | null> {
  if (recipients.length === 0) return null;
  const pdas = recipients.map((owner) => solanaExitPda(programId, poolState, owner));
  try {
    const accounts = await connection.getMultipleAccountsInfo(pdas);
    const allRegistered = accounts.every(
      (account) => account !== null && account.owner.equals(programId) && account.data.length > 0,
    );
    return allRegistered ? pdas : null;
  } catch {
    // An RPC hiccup must not silently downgrade a withdrawal into a path that
    // needs someone to answer; fall back rather than fail, and let the approval
    // route carry it.
    return null;
  }
}
