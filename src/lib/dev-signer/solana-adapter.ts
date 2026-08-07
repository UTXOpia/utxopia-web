import {
  BaseMessageSignerWalletAdapter,
  WalletReadyState,
  type WalletName,
} from "@solana/wallet-adapter-base";
import { ed25519 } from "@noble/curves/ed25519";
import {
  Keypair,
  PublicKey,
  VersionedTransaction,
  type Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";

export const DevWalletName =
  "UTXOpia Dev Signer" as WalletName<"UTXOpia Dev Signer">;

/** Message signing is not optional here even though nothing in the token loop
 *  needs it. Invite redemption is authorised by signing a server nonce, and
 *  `useWallet().signMessage` is undefined on a transaction-only adapter — so the
 *  "Redeem invite code" button stayed disabled with no error, and the beta's
 *  one admission path was the one path an E2E run could never reach. */
export class DevSolanaWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = DevWalletName;
  url = "https://utxopia.local/dev";
  icon = "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=";
  readonly supportedTransactionVersions = new Set([
    "legacy",
    0,
  ] as const) as ReadonlySet<"legacy" | 0>;

  private _keypair: Keypair;
  private _connecting = false;
  private _publicKey: PublicKey | null = null;

  constructor(secretKeyB58: string) {
    super();
    this._keypair = Keypair.fromSecretKey(bs58.decode(secretKeyB58));
  }

  get connecting(): boolean {
    return this._connecting;
  }

  get publicKey(): PublicKey | null {
    return this._publicKey;
  }

  get readyState(): WalletReadyState {
    return WalletReadyState.Installed;
  }

  async connect(): Promise<void> {
    this._connecting = true;
    this._publicKey = this._keypair.publicKey;
    this._connecting = false;
    this.emit("connect", this._publicKey);
  }

  async disconnect(): Promise<void> {
    this._publicKey = null;
    this.emit("disconnect");
  }

  async signTransaction<T extends Transaction | VersionedTransaction>(
    tx: T,
  ): Promise<T> {
    if (tx instanceof VersionedTransaction) {
      tx.sign([this._keypair]);
    } else {
      tx.partialSign(this._keypair);
    }
    return tx;
  }

  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    // Keypair.secretKey is the 64-byte expanded form; ed25519 signs from the
    // 32-byte seed that prefixes it.
    return ed25519.sign(message, this._keypair.secretKey.slice(0, 32));
  }
}
