"use client";

import { useCallback, useMemo } from "react";
import type { ReactNode } from "react";
import { PrivyProvider, useLogin, usePrivy } from "@privy-io/react-auth";
import {
  toSolanaWalletConnectors,
  useCreateWallet,
  useSignMessage,
  useSignTransaction,
  useWallets,
  type ConnectedStandardSolanaWallet,
} from "@privy-io/react-auth/solana";
import { createSolanaRpc, createSolanaRpcSubscriptions } from "@solana/kit";
import { PublicKey, Transaction } from "@solana/web3.js";
import { getSolanaRpcUrl, getSolanaWsUrl } from "@/lib/api/constants";
import { detectNetwork } from "@/lib/network-config";
import {
  PrivySolanaContext,
  type PrivySolanaAuthority,
} from "@/lib/privy-solana-context";

type PrivySolanaChain = "solana:mainnet" | "solana:devnet" | "solana:testnet";

/**
 * Read from the resolved network, not from the RPC URL: in the browser that URL
 * is now the same-origin proxy, whose hostname says nothing about the cluster.
 */
function inferSolanaChain(): PrivySolanaChain {
  const network = detectNetwork();
  if (network === "mainnet") return "solana:mainnet";
  if (network === "testnet") return "solana:testnet";
  return "solana:devnet";
}

function findEmbeddedWallet(wallets: ConnectedStandardSolanaWallet[]) {
  return wallets.find((wallet) => wallet.standardWallet.name === "Privy") ?? wallets[0] ?? null;
}

function PrivySolanaBridge({ children }: { children: ReactNode }) {
  const { ready: privyReady, authenticated } = usePrivy();
  const { login } = useLogin();
  const { ready: walletsReady, wallets } = useWallets();
  const { createWallet } = useCreateWallet();
  const { signTransaction } = useSignTransaction();
  const { signMessage } = useSignMessage();
  const solanaChain = inferSolanaChain();

  const wallet = useMemo(() => findEmbeddedWallet(wallets), [wallets]);
  const publicKey = useMemo(
    () => (wallet?.address ? new PublicKey(wallet.address) : null),
    [wallet],
  );
  const openLogin = useCallback(async () => {
    login();
  }, [login]);

  const ensureWallet = useCallback(async () => {
    if (!authenticated) {
      login();
      return null;
    }

    const currentWallet = findEmbeddedWallet(wallets);
    if (currentWallet?.address) return new PublicKey(currentWallet.address);

    const created = await createWallet({ createAdditional: false });
    return created.wallet.address ? new PublicKey(created.wallet.address) : null;
  }, [authenticated, createWallet, login, wallets]);

  const signPrivyTransaction = useCallback(
    async (transaction: Transaction) => {
      const signingWallet = findEmbeddedWallet(wallets);
      if (!signingWallet) throw new Error("Privy Solana wallet is not ready");

      const { signedTransaction } = await signTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
        wallet: signingWallet,
        chain: solanaChain,
      });
      return Transaction.from(signedTransaction);
    },
    [signTransaction, solanaChain, wallets],
  );

  const signPrivyMessage = useCallback(
    async (message: Uint8Array) => {
      const signingWallet = findEmbeddedWallet(wallets);
      if (!signingWallet) throw new Error("Privy Solana wallet is not ready");

      const { signature } = await signMessage({ message, wallet: signingWallet });
      // The wrapping key is argon2id(PIN, sha256(signature)), so a short or
      // re-encoded signature silently produces a key nobody can reproduce and
      // the member is told their PIN is wrong. Fail here, where it is legible.
      if (signature.length !== 64) {
        throw new Error(`Unexpected Privy signature length: ${signature.length}`);
      }
      return signature;
    },
    [signMessage, wallets],
  );

  const value = useMemo<PrivySolanaAuthority>(
    () => ({
      enabled: true,
      ready: privyReady && walletsReady,
      authenticated,
      publicKey,
      login: openLogin,
      ensureWallet,
      signTransaction: signPrivyTransaction,
      signMessage: signPrivyMessage,
    }),
    [
      authenticated,
      ensureWallet,
      openLogin,
      privyReady,
      publicKey,
      signPrivyTransaction,
      signPrivyMessage,
      walletsReady,
    ],
  );

  return <PrivySolanaContext.Provider value={value}>{children}</PrivySolanaContext.Provider>;
}

export function EnabledPrivySolanaProvider({
  appId,
  clientId,
  children,
}: {
  appId: string;
  clientId?: string;
  children: ReactNode;
}) {
  const rpcUrl = getSolanaRpcUrl();
  const solanaChain = inferSolanaChain();

  return (
    <PrivyProvider
      appId={appId}
      clientId={clientId}
      config={{
        // Privy's own passkey is deliberately absent: it would mint a second
        // credential beside the one whose PRF wraps the vault, and re-pointing
        // the stored credential id orphans every wrapping on the device.
        loginMethods: ["email", "wallet", "google", "farcaster"],
        appearance: { theme: "dark", accentColor: "#14F195" },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true,
        },
        externalWallets: { solana: { connectors: toSolanaWalletConnectors() } },
        solana: {
          rpcs: {
            [solanaChain]: {
              rpc: createSolanaRpc(rpcUrl),
              rpcSubscriptions: createSolanaRpcSubscriptions(getSolanaWsUrl()),
              blockExplorerUrl: "https://explorer.solana.com",
            },
          },
        },
      }}
    >
      <PrivySolanaBridge>{children}</PrivySolanaBridge>
    </PrivyProvider>
  );
}
