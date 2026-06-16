import {
  BaseSignerWalletAdapter,
  WalletReadyState,
  type WalletName,
} from "@solana/wallet-adapter-base";
import {
  Keypair,
  PublicKey,
  VersionedTransaction,
  type Transaction,
} from "@solana/web3.js";
import bs58 from "bs58";

export const DevWalletName =
  "UTXOpia Dev Signer" as WalletName<"UTXOpia Dev Signer">;

export class DevSolanaWalletAdapter extends BaseSignerWalletAdapter {
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
}
