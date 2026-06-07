/**
 * ChadBuffer operations — upload arbitrary data (raw txs, proofs) to a
 * ChadBuffer account for on-chain SPV/proof verification, and close buffers to
 * reclaim rent. Shared by the verify and sol/relay route handlers.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  TransactionInstruction,
  SystemProgram,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import { AUTHORITY_SIZE } from "@utxopia/sdk";

export const CHADBUFFER = { INIT: 0, WRITE: 2, CLOSE: 3 } as const;
const FIRST_CHUNK_SIZE = 800;
const MAX_CHUNK_SIZE = 950;

/**
 * Upload data to a freshly created ChadBuffer account, chunked across as many
 * confirmed transactions as needed. Returns the buffer's pubkey + keypair.
 */
export async function uploadDataToBuffer(
  connection: Connection,
  relayer: Keypair,
  data: Uint8Array,
  chadbufferProgramId: PublicKey,
  label = "ChadBuffer",
): Promise<{ bufferPubkey: PublicKey; bufferKeypair: Keypair }> {
  const bufferKeypair = Keypair.generate();
  const bufferSize = AUTHORITY_SIZE + data.length;
  const rentExemption = await connection.getMinimumBalanceForRentExemption(bufferSize);

  console.log(`[${label}] Creating buffer for ${data.length} bytes...`);

  // TX 1: Create account + init with first chunk
  const firstChunkSize = Math.min(FIRST_CHUNK_SIZE, data.length);
  const firstChunk = data.slice(0, firstChunkSize);

  const createAccountIx = SystemProgram.createAccount({
    fromPubkey: relayer.publicKey,
    newAccountPubkey: bufferKeypair.publicKey,
    lamports: rentExemption,
    space: bufferSize,
    programId: chadbufferProgramId,
  });

  const initData = Buffer.alloc(1 + firstChunk.length);
  initData[0] = CHADBUFFER.INIT;
  Buffer.from(firstChunk).copy(initData, 1);

  const initIx = new TransactionInstruction({
    programId: chadbufferProgramId,
    keys: [
      { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
      { pubkey: bufferKeypair.publicKey, isSigner: true, isWritable: true },
    ],
    data: initData,
  });

  const { blockhash: blockhash1 } = await connection.getLatestBlockhash();
  const tx1 = new Transaction();
  tx1.add(createAccountIx, initIx);
  tx1.feePayer = relayer.publicKey;
  tx1.recentBlockhash = blockhash1;

  await sendAndConfirmTransaction(connection, tx1, [relayer, bufferKeypair], {
    commitment: "confirmed",
  });

  // TX 2+: Write remaining chunks
  let dataOffset = firstChunkSize;

  while (dataOffset < data.length) {
    const chunkSize = Math.min(MAX_CHUNK_SIZE, data.length - dataOffset);
    const chunk = data.slice(dataOffset, dataOffset + chunkSize);
    const bufferOffset = AUTHORITY_SIZE + dataOffset;

    const writeData = Buffer.alloc(4 + chunk.length);
    writeData[0] = CHADBUFFER.WRITE;
    writeData[1] = bufferOffset & 0xff;
    writeData[2] = (bufferOffset >> 8) & 0xff;
    writeData[3] = (bufferOffset >> 16) & 0xff;
    Buffer.from(chunk).copy(writeData, 4);

    const writeIx = new TransactionInstruction({
      programId: chadbufferProgramId,
      keys: [
        { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
        { pubkey: bufferKeypair.publicKey, isSigner: false, isWritable: true },
      ],
      data: writeData,
    });

    const { blockhash } = await connection.getLatestBlockhash();
    const writeTx = new Transaction();
    writeTx.add(writeIx);
    writeTx.feePayer = relayer.publicKey;
    writeTx.recentBlockhash = blockhash;

    await sendAndConfirmTransaction(connection, writeTx, [relayer], {
      commitment: "confirmed",
    });

    dataOffset += chunkSize;
  }

  console.log(`[${label}] Buffer upload complete (${data.length} bytes)`);
  return { bufferPubkey: bufferKeypair.publicKey, bufferKeypair };
}

/**
 * Close a ChadBuffer to reclaim rent.
 */
export async function closeBuffer(
  connection: Connection,
  relayer: Keypair,
  bufferPubkey: PublicKey,
  chadbufferProgramId: PublicKey,
  label = "ChadBuffer",
): Promise<void> {
  const closeIx = new TransactionInstruction({
    programId: chadbufferProgramId,
    keys: [
      { pubkey: relayer.publicKey, isSigner: true, isWritable: true },
      { pubkey: bufferPubkey, isSigner: false, isWritable: true },
    ],
    data: Buffer.from([CHADBUFFER.CLOSE]),
  });

  const { blockhash } = await connection.getLatestBlockhash();
  const closeTx = new Transaction();
  closeTx.add(closeIx);
  closeTx.feePayer = relayer.publicKey;
  closeTx.recentBlockhash = blockhash;

  await sendAndConfirmTransaction(connection, closeTx, [relayer], {
    commitment: "confirmed",
  });

  console.log(`[${label}] Buffer closed, rent reclaimed`);
}
