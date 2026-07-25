import { ConnectionMagicRouter } from "@magicblock-labs/ephemeral-rollups-sdk";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  type Commitment,
} from "@solana/web3.js";
import {
  assertMagicBlockClientConfig,
  type MagicBlockClientConfig,
} from "@/lib/magicblock-config";

const MAGIC_CONTEXT_ID = new PublicKey(
  "MagicContext1111111111111111111111111111111"
);
const MAGIC_PROGRAM_ID = new PublicKey(
  "Magic11111111111111111111111111111111111111"
);
const PERMISSION_PROGRAM_ID = new PublicKey(
  "ACLseoPoyC3cBqoUtkbjZ4aDrkurZW86v19pXz2XQnp1"
);
const PERMISSION_SEED = Buffer.from("permission:");

export interface MagicBlockExecutionConnections {
  base: Connection;
  execution: Connection;
  usesRouter: boolean;
}

export function createMagicBlockExecutionConnections(
  baseRpcUrl: string,
  config: MagicBlockClientConfig
): MagicBlockExecutionConnections {
  assertMagicBlockClientConfig(config);
  const base = new Connection(baseRpcUrl, "confirmed");
  if (config.executionMode === "solana") {
    return { base, execution: base, usesRouter: false };
  }

  const httpHeaders = config.executionMode === "per"
    ? { Authorization: `Bearer ${config.perAuthToken}` }
    : undefined;
  const routerEndpoint = config.executionMode === "per"
    ? config.perUrl!
    : config.routerUrl;
  const execution = new ConnectionMagicRouter(routerEndpoint, {
    commitment: "confirmed",
    httpHeaders,
  });
  return { base, execution, usesRouter: true };
}

export async function assertDelegatedExecutionCluster(
  connection: ConnectionMagicRouter,
  poolState: PublicKey,
  commitmentTree: PublicKey,
  mode: MagicBlockClientConfig["executionMode"]
): Promise<void> {
  const [poolStatus, treeStatus] = await Promise.all([
    connection.getDelegationStatus(poolState),
    connection.getDelegationStatus(commitmentTree),
  ]);
  if (!poolStatus?.isDelegated || !treeStatus?.isDelegated) {
    throw new Error("MagicBlock transfer requires both pool and active tree to be delegated");
  }

  if (mode === "per") {
    const permissionAccounts = [poolState, commitmentTree].map((account) =>
      PublicKey.findProgramAddressSync(
        [PERMISSION_SEED, account.toBuffer()],
        PERMISSION_PROGRAM_ID
      )[0]
    );
    const permissionInfos = await Promise.all(
      permissionAccounts.map((permission) => connection.getAccountInfo(permission))
    );
    if (permissionInfos.some(
      (info) => !info || !info.owner.equals(PERMISSION_PROGRAM_ID) || info.data.length === 0
    )) {
      throw new Error("PER transfer requires initialized pool and tree permission accounts");
    }
  }
}

export function buildMagicBlockAtomicCommitInstruction(options: {
  programId: PublicKey;
  payer: PublicKey;
  poolState: PublicKey;
  commitmentTree: PublicKey;
  nullifierAccounts: PublicKey[];
  nullifierHashes: Uint8Array[];
}): TransactionInstruction {
  if (
    options.nullifierHashes.length === 0 ||
    options.nullifierHashes.length > 10 ||
    options.nullifierAccounts.length !== options.nullifierHashes.length
  ) {
    throw new Error("MagicBlock commit requires matching 1-10 nullifiers");
  }
  for (const hash of options.nullifierHashes) {
    if (hash.length !== 32) {
      throw new Error("MagicBlock commit nullifier hashes must be 32 bytes");
    }
  }

  const data = Buffer.alloc(4 + options.nullifierHashes.length * 32);
  data[0] = 33;
  data[1] = 1;
  data[2] = 0;
  data[3] = options.nullifierHashes.length;
  options.nullifierHashes.forEach((hash, index) => {
    Buffer.from(hash).copy(data, 4 + index * 32);
  });

  return new TransactionInstruction({
    programId: options.programId,
    keys: [
      { pubkey: options.payer, isSigner: true, isWritable: false },
      { pubkey: options.payer, isSigner: true, isWritable: false },
      { pubkey: MAGIC_CONTEXT_ID, isSigner: false, isWritable: true },
      { pubkey: MAGIC_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: options.poolState, isSigner: false, isWritable: true },
      { pubkey: options.commitmentTree, isSigner: false, isWritable: true },
      ...options.nullifierAccounts.map((pubkey) => ({
        pubkey,
        isSigner: false,
        isWritable: true,
      })),
    ],
    data,
  });
}

export async function sendMagicBlockAwareTransaction(
  connections: MagicBlockExecutionConnections,
  transaction: Transaction,
  signers: Keypair[],
  commitment: Commitment = "confirmed"
): Promise<string> {
  if (connections.execution instanceof ConnectionMagicRouter) {
    return connections.execution.sendAndConfirmTransaction(transaction, signers, {
      commitment,
    });
  }
  const latest = await connections.base.getLatestBlockhash(commitment);
  transaction.recentBlockhash = latest.blockhash;
  transaction.lastValidBlockHeight = latest.lastValidBlockHeight;
  return sendAndConfirmTransaction(connections.base, transaction, signers, {
    commitment,
  });
}
