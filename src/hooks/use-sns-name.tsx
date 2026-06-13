"use client";

import { useState, useCallback, useEffect, useMemo } from "react";
import { useConnection, useWallet } from "@solana/wallet-adapter-react";
import { PublicKey, Transaction, TransactionInstruction, SystemProgram, SYSVAR_RENT_PUBKEY } from "@solana/web3.js";
import { TOKEN_PROGRAM_ID, NATIVE_MINT, getAssociatedTokenAddressSync, createAssociatedTokenAccountIdempotentInstruction, createSyncNativeInstruction, createCloseAccountInstruction } from "@solana/spl-token";
import { useUTXOpiaKeys } from "./use-utxopia";
import { usePrivySolanaAuthority } from "@/lib/privy-solana";
import { usePasskeySolanaAuthority } from "@/hooks/use-passkey-solana-authority";
import {
  parseSnsStealthData,
  type SnsStealthAddress,
} from "@utxopia/sdk";
import { useChainEnvironment } from "@/lib/chain-environment";
import {
  deriveParentDomainKey,
  deriveReverseLookupKey,
  deriveSubdomainKey,
  getSnsConfig,
  isSnsSubdomainRegistered,
  resolveSnsNameForNetwork,
} from "@/lib/names/sns";

/** SPL Name Service instruction discriminators */
const SNS_DISC_UPDATE = 1;
const SNS_DISC_REALLOC = 4;

/** Stealth data: version(1) + viewingPubKey(32) + mpk(32) = 65 bytes */
const STEALTH_DATA_SIZE = 65;

/** Current stealth data version */
const STEALTH_DATA_VERSION = 2;

/** Bonfida fee owner (constant across networks) */
const BONFIDA_FEE_OWNER = new PublicKey("5D2zKog251d6KPCyFyLMt3KroWwXXPWSgTPyhV22K2gR");

function bytesToHex(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("hex");
}

interface UseSnsNameReturn {
  registeredSnsName: string | null;
  hasRegisteredSnsName: boolean;
  needsUpdate: boolean;
  isLoading: boolean;
  isRegistering: boolean;
  error: string | null;
  /** Compliance-flag byte on the registered SNS subdomain (0 if none). */
  complianceFlags: number;
  /** Optional 32-byte auditor Solana pubkey published on the user's SNS. */
  auditorPubkey: Uint8Array | null;
  lookupMySnsName: () => Promise<void>;
  lookupSnsName: (name: string) => Promise<SnsStealthAddress | null>;
  isNameRegistered: (name: string) => Promise<boolean>;
  registerSnsSubdomain: (name: string) => Promise<boolean>;
  updateSnsStealthData: () => Promise<boolean>;
  /** Set the compliance-flag byte on the user's registered SNS subdomain. */
  setComplianceFlag: (value: number) => Promise<boolean>;
  /** Set or clear the 32-byte auditor pubkey on the user's SNS subdomain.
   *  Pass null to zero out the slot. */
  setAuditorPubkey: (value: PublicKey | null) => Promise<boolean>;
  canRegister: boolean;
  authorityLabel: "wallet" | "privy" | "passkey" | null;
}

/**
 * Hook for managing *.utxopia.sol SNS subdomain stealth addresses.
 *
 * Responsibilities:
 * - Auto-detect if connected wallet owns a *.utxopia.sol subdomain
 * - Resolve subdomain names to stealth keys
 * - Register new subdomains with stealth data (3-transaction flow)
 */
export function useSnsName(): UseSnsNameReturn {
  const { connection } = useConnection();
  const wallet = useWallet();
  const privySolana = usePrivySolanaAuthority();
  const passkeySolana = usePasskeySolanaAuthority();
  const { stealthAddress } = useUTXOpiaKeys();
  const { networkId, config: networkConfig } = useChainEnvironment();
  const snsConfig = useMemo(() => getSnsConfig(networkConfig), [networkConfig]);

  const [registeredSnsName, setRegisteredSnsName] = useState<string | null>(null);
  const [hasRegisteredSnsName, setHasRegisteredSnsName] = useState(false);
  const [complianceFlags, setComplianceFlags] = useState(0);
  const [auditorPubkey, setAuditorPubkeyState] = useState<Uint8Array | null>(null);
  const [needsUpdate, setNeedsUpdate] = useState(false);
  const [registeredSubdomainKey, setRegisteredSubdomainKey] = useState<PublicKey | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isRegistering, setIsRegistering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const walletAuthority = useMemo(
    () => wallet.publicKey && wallet.signTransaction
      ? { publicKey: wallet.publicKey, label: "wallet" as const }
      : null,
    [wallet.publicKey, wallet.signTransaction],
  );
  const privyAuthority = useMemo(
    () => privySolana.publicKey
      ? { publicKey: privySolana.publicKey, label: "privy" as const }
      : null,
    [privySolana.publicKey],
  );
  const passkeyAuthority = useMemo(
    () => passkeySolana.publicKey
      ? { publicKey: passkeySolana.publicKey, label: "passkey" as const }
      : null,
    [passkeySolana.publicKey],
  );
  const activeAuthority = walletAuthority ?? privyAuthority ?? passkeyAuthority;
  const canRegister = Boolean(snsConfig && (walletAuthority || privySolana.enabled || passkeySolana.enabled));

  const signAndSubmitSnsTransaction = useCallback(async (
    tx: Transaction,
    signer: PublicKey,
  ) => {
    if (wallet.publicKey?.equals(signer) && wallet.signTransaction) {
      return wallet.signTransaction(tx);
    }
    if (privySolana.publicKey?.equals(signer)) {
      return privySolana.signTransaction(tx);
    }
    if (passkeySolana.publicKey?.equals(signer)) {
      return passkeySolana.signTransaction(tx);
    }
    throw new Error("No Solana signer available for SNS transaction");
  }, [passkeySolana, privySolana, wallet]);

  const registerViaRelayer = useCallback(async (
    name: string,
    owner: PublicKey,
    stealthData: Uint8Array,
  ): Promise<"success" | "unavailable"> => {
    const networkQuery = `?network=${encodeURIComponent(networkId)}`;
    const prepareResp = await fetch(`/api/sns/register${networkQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "prepare",
        name,
        owner: owner.toBase58(),
        stealthData: bytesToHex(stealthData),
      }),
    });
    const prepared = await prepareResp.json().catch(() => null) as
      | { success?: boolean; transaction?: string; error?: string; relayerUnavailable?: boolean }
      | null;

    if (!prepareResp.ok || !prepared?.success || !prepared.transaction) {
      if (prepared?.relayerUnavailable) return "unavailable";
      throw new Error(prepared?.error || "Failed to prepare sponsored SNS registration");
    }

    const tx = Transaction.from(Buffer.from(prepared.transaction, "base64"));
    const signed = await signAndSubmitSnsTransaction(tx, owner);
    const submitResp = await fetch(`/api/sns/register${networkQuery}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "submit",
        signedTransaction: signed.serialize().toString("base64"),
      }),
    });
    const submitted = await submitResp.json().catch(() => null) as
      | { success?: boolean; error?: string }
      | null;
    if (!submitResp.ok || !submitted?.success) {
      throw new Error(submitted?.error || "Failed to submit sponsored SNS registration");
    }
    return "success";
  }, [networkId, signAndSubmitSnsTransaction]);

  // Resolve an SNS name to stealth keys
  const lookupSnsName = useCallback(async (name: string): Promise<SnsStealthAddress | null> => {
    if (!snsConfig) return null;
    return resolveSnsNameForNetwork(connection, name, snsConfig);
  }, [connection, snsConfig]);

  const isNameRegistered = useCallback(async (name: string): Promise<boolean> => {
    if (!snsConfig) return false;
    return isSnsSubdomainRegistered(connection, name, snsConfig);
  }, [connection, snsConfig]);

  // Check if connected wallet owns a *.utxopia.sol subdomain
  const lookupMySnsName = useCallback(async () => {
    const owner = activeAuthority?.publicKey;
    if (!owner || !stealthAddress) return;

    if (!snsConfig) return;

    setIsLoading(true);
    setError(null);

    try {
      // Get parent domain key for memcmp filter
      const parentPubkey = deriveParentDomainKey(snsConfig);

      // Search for name accounts owned by this wallet under the parent domain
      const nameServiceProgramId = new PublicKey(snsConfig.nameServiceProgramId);
      const accounts = await connection.getProgramAccounts(nameServiceProgramId, {
        filters: [
          // parent field at offset 0 = parentKey (32 bytes)
          { memcmp: { offset: 0, bytes: parentPubkey.toBase58() } },
          // owner field at offset 32 = wallet pubkey (32 bytes)
          { memcmp: { offset: 32, bytes: owner.toBase58() } },
        ],
      });

      // Check each matched account for stealth data
      for (const account of accounts) {
        const parsed = parseSnsStealthData(new Uint8Array(account.account.data));
        if (parsed) {
          const ourViewing = Buffer.from(stealthAddress.viewingPubKey).toString("hex");
          const foundViewing = Buffer.from(parsed.viewingPubKey).toString("hex");

          if (ourViewing === foundViewing) {
            setHasRegisteredSnsName(true);
            setRegisteredSubdomainKey(account.pubkey);
            setComplianceFlags(parsed.complianceFlags ?? 0);
            setAuditorPubkeyState(parsed.auditorPubkey ?? null);

            // Detect if record needs update (old version, zero mpk, or stale mpk)
            const mpkAllZero = parsed.mpk.every((b: number) => b === 0);
            const isOldVersion = parsed.version !== STEALTH_DATA_VERSION;
            const ourMpk = Buffer.from(stealthAddress.mpk).toString("hex");
            const foundMpk = Buffer.from(parsed.mpk).toString("hex");
            const mpkMismatch = ourMpk !== foundMpk;
            setNeedsUpdate(mpkAllZero || isOldVersion || mpkMismatch);

            // Reverse lookup: derive reverse key from subdomain account key
            const reverseKey = deriveReverseLookupKey(account.pubkey, parentPubkey, snsConfig);
            const reverseAcct = await connection.getAccountInfo(reverseKey);
            if (reverseAcct && reverseAcct.data.length > 100) {
              // SNS header(96) + borsh string(u32 len + bytes)
              const nameLen = reverseAcct.data.readUInt32LE(96);
              const rawName = reverseAcct.data.slice(100, 100 + nameLen).toString().replace(/\0/g, "").trim();
              if (rawName) {
                setRegisteredSnsName(rawName);
                setIsLoading(false);
                return;
              }
            }
            setRegisteredSnsName(null);
            setIsLoading(false);
            return;
          }
        }
      }

      setHasRegisteredSnsName(false);
      setNeedsUpdate(false);
      setRegisteredSubdomainKey(null);
      setRegisteredSnsName(null);
    } catch (err) {
      console.error("Failed to lookup SNS name:", err);
      setError("Failed to check SNS name registration");
    } finally {
      setIsLoading(false);
    }
  }, [activeAuthority?.publicKey, stealthAddress, connection, snsConfig]);

  // Register a new subdomain + write stealth data (2-transaction flow)
  // TX1: Register via Bonfida sub-registrar (creates subdomain + reverse lookup)
  // TX2: Realloc + write stealth data (combined into one TX)
  const registerSnsSubdomain = useCallback(async (name: string): Promise<boolean> => {
    if (!stealthAddress) {
      setError("Private keys not derived");
      return false;
    }

    if (!snsConfig) {
      setError("SNS not configured for this network");
      return false;
    }

    const subdomain = name.trim().toLowerCase();
    if (!subdomain || subdomain.includes(".") || subdomain.length > 32) {
      setError("Invalid subdomain name");
      return false;
    }

    setIsRegistering(true);
    setError(null);

    try {
      const owner = walletAuthority?.publicKey
        ?? passkeyAuthority?.publicKey
        ?? await privySolana.ensureWallet();
      if (!owner) {
        setError(privySolana.enabled
          ? "Finish Privy sign-in, then click Register again"
          : "Connect a Solana wallet to register a name");
        return false;
      }

      // Check if already exists
      if (await isNameRegistered(subdomain)) {
        setError(`"${subdomain}.${snsConfig.parentDomain}.sol" is already registered`);
        return false;
      }

      const stealthData = new Uint8Array(STEALTH_DATA_SIZE);
      stealthData[0] = STEALTH_DATA_VERSION;
      stealthData.set(stealthAddress.viewingPubKey, 1);
      stealthData.set(stealthAddress.mpk, 33);

      const sponsoredResult = await registerViaRelayer(subdomain, owner, stealthData);
      if (sponsoredResult === "success") {
        setRegisteredSnsName(subdomain);
        setHasRegisteredSnsName(true);
        return true;
      }

      const nameServiceProgramId = new PublicKey(snsConfig.nameServiceProgramId);
      const subRegistrarProgramId = new PublicKey(snsConfig.subRegistrarProgramId);
      const snsRegistrarProgramId = new PublicKey(snsConfig.registrarProgramId);
      const rootDomain = new PublicKey(snsConfig.rootDomain);

      // Derive parent domain key
      const parentPubkey = deriveParentDomainKey(snsConfig);

      // Derive subdomain key: hash("\0" + name) under parent
      const subdomainKey = deriveSubdomainKey(subdomain, parentPubkey, snsConfig);

      // Derive reverse lookup key: hash(subdomainKey.base58) under [reverseLookupClass, parent]
      const reverseLookupClass = new PublicKey(snsConfig.reverseLookupClass);
      const reverseKey = deriveReverseLookupKey(subdomainKey, parentPubkey, snsConfig);

      // Derive registrar PDA: ["registrar", parentDomainKey]
      const [registrar] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("registrar"), parentPubkey.toBytes()],
        subRegistrarProgramId,
      );

      // Derive sub-record PDA: ["subrecord", subdomainKey]
      const [subRecord] = PublicKey.findProgramAddressSync(
        [new TextEncoder().encode("subrecord"), subdomainKey.toBytes()],
        subRegistrarProgramId,
      );

      // Fetch registrar state to get mint and fee account
      const registrarAcct = await connection.getAccountInfo(registrar);
      if (!registrarAcct) {
        setError("Sub-registrar not initialized for this domain");
        return false;
      }
      // Registrar layout: tag(1) + nonce(1) + authority(32) + feeAccount(32) + mint(32) + domain(32) + ...
      const feeAccount = new PublicKey(registrarAcct.data.slice(34, 66));
      const mint = new PublicKey(registrarAcct.data.slice(66, 98));

      // Buyer's token account for the registration fee (wSOL)
      const feeSource = getAssociatedTokenAddressSync(mint, owner, true);

      // Bonfida fee account
      const bonfidaFee = getAssociatedTokenAddressSync(mint, BONFIDA_FEE_OWNER, true);

      // === TX1: Register subdomain via Bonfida sub-registrar ===
      const ixs: TransactionInstruction[] = [];

      // Ensure buyer's wSOL ATA exists and has enough balance for registration fee
      const WSOL_WRAP_AMOUNT = 10_000_000; // 0.01 SOL — enough for any registration fee
      const feeSourceAcct = await connection.getAccountInfo(feeSource);
      let needsWrap = true;
      if (feeSourceAcct && feeSourceAcct.data.length >= 72) {
        // SPL Token account: amount is u64 LE at offset 64
        const balance = new DataView(feeSourceAcct.data.buffer, feeSourceAcct.data.byteOffset).getBigUint64(64, true);
        if (balance >= BigInt(WSOL_WRAP_AMOUNT)) {
          needsWrap = false;
        }
      }

      if (needsWrap) {
        ixs.push(createAssociatedTokenAccountIdempotentInstruction(
          owner,
          feeSource,
          owner,
          NATIVE_MINT,
        ));
        ixs.push(SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: feeSource,
          lamports: WSOL_WRAP_AMOUNT,
        }));
        ixs.push(createSyncNativeInstruction(feeSource));
      }

      // Ensure Bonfida fee ATA exists
      ixs.push(createAssociatedTokenAccountIdempotentInstruction(
        owner,
        bonfidaFee,
        BONFIDA_FEE_OWNER,
        mint,
      ));

      // Sub-registrar register instruction: tag(1=2) + domain(borsh string: len_u32 + "\0" + name)
      const domainStr = "\0" + subdomain;
      const domainBytes = new TextEncoder().encode(domainStr);
      const registerData = new Uint8Array(1 + 4 + domainBytes.length);
      registerData[0] = 2; // discriminator: register
      new DataView(registerData.buffer).setUint32(1, domainBytes.length, true);
      registerData.set(domainBytes, 5);

      ixs.push(new TransactionInstruction({
        programId: subRegistrarProgramId,
        keys: [
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
          { pubkey: nameServiceProgramId, isSigner: false, isWritable: false },
          { pubkey: SYSVAR_RENT_PUBKEY, isSigner: false, isWritable: false },
          { pubkey: snsRegistrarProgramId, isSigner: false, isWritable: false },
          { pubkey: rootDomain, isSigner: false, isWritable: false },
          { pubkey: reverseLookupClass, isSigner: false, isWritable: false },
          { pubkey: feeAccount, isSigner: false, isWritable: true },
          { pubkey: feeSource, isSigner: false, isWritable: true },
          { pubkey: registrar, isSigner: false, isWritable: true },
          { pubkey: parentPubkey, isSigner: false, isWritable: true },
          { pubkey: subdomainKey, isSigner: false, isWritable: true },
          { pubkey: reverseKey, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: bonfidaFee, isSigner: false, isWritable: true },
          { pubkey: subRecord, isSigner: false, isWritable: true },
        ],
        data: Buffer.from(registerData),
      }));

      // Close wSOL ATA after registration to reclaim rent + unused wSOL (only if we created it)
      if (needsWrap) {
        ixs.push(createCloseAccountInstruction(
          feeSource,
          owner,
          owner,
        ));
      }

      // === Realloc + Write stealth data (appended to same TX) ===
      const reallocData = new Uint8Array(5);
      reallocData[0] = SNS_DISC_REALLOC;
      new DataView(reallocData.buffer).setUint32(1, STEALTH_DATA_SIZE, true);

      ixs.push(new TransactionInstruction({
        programId: nameServiceProgramId,
        keys: [
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: subdomainKey, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: false },
        ],
        data: Buffer.from(reallocData),
      }));

      const updateData = new Uint8Array(1 + 4 + 4 + stealthData.length);
      updateData[0] = SNS_DISC_UPDATE;
      new DataView(updateData.buffer).setUint32(1, 0, true);
      new DataView(updateData.buffer).setUint32(5, stealthData.length, true);
      updateData.set(stealthData, 9);

      ixs.push(new TransactionInstruction({
        programId: nameServiceProgramId,
        keys: [
          { pubkey: subdomainKey, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: false },
        ],
        data: Buffer.from(updateData),
      }));

      const tx = new Transaction().add(...ixs);
      tx.feePayer = owner;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      const signed = await signAndSubmitSnsTransaction(tx, owner);
      const txid = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, "confirmed");
      setRegisteredSnsName(subdomain);
      setHasRegisteredSnsName(true);
      return true;
    } catch (err) {
      console.error("Failed to register SNS subdomain:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage || "Failed to register subdomain");
      return false;
    } finally {
      setIsRegistering(false);
    }
  }, [connection, isNameRegistered, passkeyAuthority, privySolana, registerViaRelayer, signAndSubmitSnsTransaction, snsConfig, stealthAddress, walletAuthority]);

  // Update existing SNS record with new stealth data format
  const updateSnsStealthData = useCallback(async (): Promise<boolean> => {
    const owner = activeAuthority?.publicKey;
    if (!owner || !stealthAddress || !registeredSubdomainKey) {
      setError("Solana authority not connected or no existing registration found");
      return false;
    }

    if (!snsConfig) {
      setError("SNS not configured");
      return false;
    }

    setIsRegistering(true);
    setError(null);

    try {
      const nameServiceProgramId = new PublicKey(snsConfig.nameServiceProgramId);
      const ixs: TransactionInstruction[] = [];

      // Realloc to new size (65 bytes — may shrink from 97)
      const reallocData = new Uint8Array(5);
      reallocData[0] = SNS_DISC_REALLOC;
      new DataView(reallocData.buffer).setUint32(1, STEALTH_DATA_SIZE, true);

      ixs.push(new TransactionInstruction({
        programId: nameServiceProgramId,
        keys: [
          { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
          { pubkey: owner, isSigner: true, isWritable: true },
          { pubkey: registeredSubdomainKey, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: false },
        ],
        data: Buffer.from(reallocData),
      }));

      // Write new stealth data: version(2) + viewingPubKey(32) + mpk(32)
      const stealthData = new Uint8Array(STEALTH_DATA_SIZE);
      stealthData[0] = STEALTH_DATA_VERSION;
      stealthData.set(stealthAddress.viewingPubKey, 1);
      stealthData.set(stealthAddress.mpk, 33);

      const updateData = new Uint8Array(1 + 4 + 4 + stealthData.length);
      updateData[0] = SNS_DISC_UPDATE;
      new DataView(updateData.buffer).setUint32(1, 0, true);
      new DataView(updateData.buffer).setUint32(5, stealthData.length, true);
      updateData.set(stealthData, 9);

      ixs.push(new TransactionInstruction({
        programId: nameServiceProgramId,
        keys: [
          { pubkey: registeredSubdomainKey, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: false },
        ],
        data: Buffer.from(updateData),
      }));

      const tx = new Transaction().add(...ixs);
      tx.feePayer = owner;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      const signed = await signAndSubmitSnsTransaction(tx, owner);
      const txid = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction({ signature: txid, blockhash, lastValidBlockHeight }, "confirmed");
      setNeedsUpdate(false);
      return true;
    } catch (err) {
      console.error("Failed to update SNS stealth data:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage || "Failed to update stealth data");
      return false;
    } finally {
      setIsRegistering(false);
    }
  }, [activeAuthority?.publicKey, stealthAddress, connection, registeredSubdomainKey, signAndSubmitSnsTransaction, snsConfig]);

  /**
   * Set the compliance-flag byte on the user's registered SNS subdomain.
   * Reallocs the account to 66 bytes (stealth payload + 1 flag byte) on
   * first write, then patches the single byte at offset 65 of the payload.
   * Mirrors `scripts/sns-set-compliance.ts` but uses the wallet adapter
   * instead of a local keypair.
   */
  const setComplianceFlag = useCallback(async (value: number): Promise<boolean> => {
    const owner = activeAuthority?.publicKey;
    if (!owner || !registeredSubdomainKey) {
      setError("Solana authority not connected or no SNS subdomain registered");
      return false;
    }
    if (!Number.isInteger(value) || value < 0 || value > 0xff) {
      setError(`compliance flag must be a u8 in [0..255]; got ${value}`);
      return false;
    }

    if (!snsConfig) {
      setError("SNS not configured");
      return false;
    }

    setIsRegistering(true);
    setError(null);

    try {
      const nameServiceProgramId = new PublicKey(snsConfig.nameServiceProgramId);
      const ixs: TransactionInstruction[] = [];

      // Account layout: 96-byte header + 65-byte stealth payload + 1-byte flag
      const targetPayloadSize = STEALTH_DATA_SIZE + 1;
      const subdomainInfo = await connection.getAccountInfo(registeredSubdomainKey);
      const currentPayloadSize = subdomainInfo ? subdomainInfo.data.length - 96 : 0;

      if (currentPayloadSize < targetPayloadSize) {
        const reallocData = new Uint8Array(5);
        reallocData[0] = SNS_DISC_REALLOC;
        new DataView(reallocData.buffer).setUint32(1, targetPayloadSize, true);
        ixs.push(new TransactionInstruction({
          programId: nameServiceProgramId,
          keys: [
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: owner, isSigner: true, isWritable: true },
            { pubkey: registeredSubdomainKey, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: false },
          ],
          data: Buffer.from(reallocData),
        }));
      }

      // Write the flag byte at offset 65 of the stealth payload.
      const updateData = new Uint8Array(1 + 4 + 4 + 1);
      updateData[0] = SNS_DISC_UPDATE;
      new DataView(updateData.buffer).setUint32(1, STEALTH_DATA_SIZE, true); // offset
      new DataView(updateData.buffer).setUint32(5, 1, true);                 // length
      updateData[9] = value;

      ixs.push(new TransactionInstruction({
        programId: nameServiceProgramId,
        keys: [
          { pubkey: registeredSubdomainKey, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: false },
        ],
        data: Buffer.from(updateData),
      }));

      const tx = new Transaction().add(...ixs);
      tx.feePayer = owner;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;

      const signed = await signAndSubmitSnsTransaction(tx, owner);
      const txid = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction(
        { signature: txid, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      setComplianceFlags(value);
      return true;
    } catch (err) {
      console.error("Failed to set SNS compliance flag:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage || "Failed to set compliance flag");
      return false;
    } finally {
      setIsRegistering(false);
    }
  }, [activeAuthority?.publicKey, connection, registeredSubdomainKey, signAndSubmitSnsTransaction, snsConfig]);

  /**
   * Set or clear the 32-byte auditor pubkey hint at offset 66 of the
   * stealth payload. Pass `null` to write 32 zero bytes (parser treats
   * all-zero as "not set"). Reallocs to 98 bytes if needed.
   */
  const setAuditorPubkey = useCallback(async (value: PublicKey | null): Promise<boolean> => {
    const owner = activeAuthority?.publicKey;
    if (!owner || !registeredSubdomainKey) {
      setError("Solana authority not connected or no SNS subdomain registered");
      return false;
    }
    if (!snsConfig) {
      setError("SNS not configured");
      return false;
    }

    setIsRegistering(true);
    setError(null);

    try {
      const nameServiceProgramId = new PublicKey(snsConfig.nameServiceProgramId);
      const ixs: TransactionInstruction[] = [];

      // Payload layout: stealth(65) + flag(1) + auditor(32) = 98 bytes
      const targetPayloadSize = STEALTH_DATA_SIZE + 1 + 32;
      const subdomainInfo = await connection.getAccountInfo(registeredSubdomainKey);
      const currentPayloadSize = subdomainInfo ? subdomainInfo.data.length - 96 : 0;

      if (currentPayloadSize < targetPayloadSize) {
        const reallocData = new Uint8Array(5);
        reallocData[0] = SNS_DISC_REALLOC;
        new DataView(reallocData.buffer).setUint32(1, targetPayloadSize, true);
        ixs.push(new TransactionInstruction({
          programId: nameServiceProgramId,
          keys: [
            { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
            { pubkey: owner, isSigner: true, isWritable: true },
            { pubkey: registeredSubdomainKey, isSigner: false, isWritable: true },
            { pubkey: owner, isSigner: true, isWritable: false },
          ],
          data: Buffer.from(reallocData),
        }));
      }

      // Write 32 bytes at offset 66 of the stealth payload.
      const pubkeyBytes = value ? value.toBytes() : new Uint8Array(32);
      const updateData = new Uint8Array(1 + 4 + 4 + 32);
      updateData[0] = SNS_DISC_UPDATE;
      new DataView(updateData.buffer).setUint32(1, STEALTH_DATA_SIZE + 1, true); // offset 66
      new DataView(updateData.buffer).setUint32(5, 32, true);                    // length
      updateData.set(pubkeyBytes, 9);

      ixs.push(new TransactionInstruction({
        programId: nameServiceProgramId,
        keys: [
          { pubkey: registeredSubdomainKey, isSigner: false, isWritable: true },
          { pubkey: owner, isSigner: true, isWritable: false },
        ],
        data: Buffer.from(updateData),
      }));

      const tx = new Transaction().add(...ixs);
      tx.feePayer = owner;
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      const signed = await signAndSubmitSnsTransaction(tx, owner);
      const txid = await connection.sendRawTransaction(signed.serialize(), {
        skipPreflight: false,
        preflightCommitment: "confirmed",
      });
      await connection.confirmTransaction(
        { signature: txid, blockhash, lastValidBlockHeight },
        "confirmed",
      );
      setAuditorPubkeyState(value ? new Uint8Array(value.toBytes()) : null);
      return true;
    } catch (err) {
      console.error("Failed to set SNS auditor pubkey:", err);
      const errorMessage = err instanceof Error ? err.message : String(err);
      setError(errorMessage || "Failed to set auditor pubkey");
      return false;
    } finally {
      setIsRegistering(false);
    }
  }, [activeAuthority?.publicKey, connection, registeredSubdomainKey, signAndSubmitSnsTransaction, snsConfig]);

  // Auto-check on mount when wallet connected
  useEffect(() => {
    if (activeAuthority?.publicKey && stealthAddress) {
      lookupMySnsName();
    } else {
      setRegisteredSnsName(null);
      setHasRegisteredSnsName(false);
      setComplianceFlags(0);
      setAuditorPubkeyState(null);
    }
  }, [activeAuthority?.publicKey, stealthAddress, lookupMySnsName]);

  return {
    registeredSnsName,
    hasRegisteredSnsName,
    needsUpdate,
    isLoading,
    isRegistering,
    error,
    complianceFlags,
    auditorPubkey,
    lookupMySnsName,
    lookupSnsName,
    isNameRegistered,
    registerSnsSubdomain,
    updateSnsStealthData,
    setComplianceFlag,
    setAuditorPubkey,
    canRegister,
    authorityLabel: activeAuthority?.label ?? (privySolana.enabled ? "privy" : null),
  };
}
