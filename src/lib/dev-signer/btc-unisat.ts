import { WIF, p2tr, utils, NETWORK, TEST_NETWORK, Transaction } from "@scure/btc-signer";
import { hex } from "@scure/base";
import { getUnisatChain } from "@/lib/btc-network";
import { getNetworkConfig, type NetworkId } from "@/lib/network-config";

/** Regtest shares testnet's key/script versions but uses the `bcrt` bech32 HRP. */
const REGTEST_NETWORK = { ...TEST_NETWORK, bech32: "bcrt" };

/** Install a window.unisat shim that signs with a WIF key. Idempotent. */
export function installUnisatShim(wif: string, networkId: NetworkId): void {
  const priv = WIF().decode(wif);
  const pub = utils.pubSchnorr(priv);
  // Derive the Bitcoin network from the app's own resolver so regtest yields
  // bcrt1p…, testnet tb1p…, mainnet bc1p… — matching getBech32Hrp.
  const btcNet = getNetworkConfig(networkId).bitcoin.network;
  const net =
    btcNet === "mainnet" ? NETWORK : btcNet === "regtest" ? REGTEST_NETWORK : TEST_NETWORK;
  const p2trAddr = p2tr(pub, undefined, net);

  const shim = {
    async requestAccounts() { return [p2trAddr.address!]; },
    async getAccounts() { return [p2trAddr.address!]; },
    async getPublicKey() { return hex.encode(pub); },
    async switchNetwork(_n: string) {},
    async switchChain(_c: string) {},
    async getNetwork() { return "testnet"; },
    async getChain() {
      return { enum: getUnisatChain(networkId), name: "test", network: "testnet" };
    },
    async signPsbt(psbtHex: string, _opts?: { autoFinalized?: boolean }) {
      const tx = Transaction.fromPSBT(hex.decode(psbtHex), { allowUnknownOutputs: true });
      tx.sign(priv);
      tx.finalize();
      return hex.encode(tx.toPSBT());
    },
  };

  (window as unknown as { unisat: typeof shim }).unisat = shim;
}
