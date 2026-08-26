"use client";

import { useCallback, useEffect, useMemo, useRef } from "react";
import type { ReactNode } from "react";
import { PrivyProvider, useLogin, useLogout, usePrivy } from "@privy-io/react-auth";
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
import { checkSignatureStability } from "@/lib/privy-signature-probe";
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
  const { ready: privyReady, authenticated, user, isModalOpen } = usePrivy();
  const { login } = useLogin();
  const { logout } = useLogout();
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

  // useWallets fills in asynchronously, and on a phone it can take seconds
  // after the session is already authenticated. Read through a ref rather than
  // the callback's captured value: every wallet decision below runs inside a
  // ceremony that started before the list arrived.
  const walletsRef = useRef({ ready: walletsReady, wallets });
  useEffect(() => {
    walletsRef.current = { ready: walletsReady, wallets };
  }, [walletsReady, wallets]);

  /**
   * The wallet list once it means something.
   *
   * Before it is ready an account that owns an embedded wallet looks like an
   * account with none — which is how a member ended up being told "User
   * already has an embedded wallet" (createWallet, refused) and, worse, how a
   * signature could be taken from whatever other wallet happened to be listed
   * first. The vault key is derived from that signature, so the wrong signer
   * is not an error, it is a PIN that no longer works.
   */
  const settledWallets = useCallback(async (timeoutMs = 15_000) => {
    const deadline = Date.now() + timeoutMs;
    while (!walletsRef.current.ready && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    return walletsRef.current.wallets;
  }, []);

  const ensureWallet = useCallback(async () => {
    if (!authenticated) {
      login();
      return null;
    }

    const currentWallet = findEmbeddedWallet(await settledWallets());
    if (currentWallet?.address) return new PublicKey(currentWallet.address);

    try {
      const created = await createWallet({ createAdditional: false });
      return created.wallet.address ? new PublicKey(created.wallet.address) : null;
    } catch (cause) {
      // Privy refuses a second embedded wallet. Reaching here means the list
      // was still empty when the timeout ran out, not that anything is wrong —
      // so wait for the one it says exists rather than surfacing its message.
      if (!/already has an embedded wallet/i.test(String(cause))) throw cause;
      const late = findEmbeddedWallet(await settledWallets(15_000));
      if (late?.address) return new PublicKey(late.address);
      throw new Error("Your wallet is still loading. Try again in a moment.");
    }
  }, [authenticated, createWallet, login, settledWallets]);

  const signPrivyTransaction = useCallback(
    async (transaction: Transaction) => {
      const signingWallet = findEmbeddedWallet(await settledWallets());
      if (!signingWallet) throw new Error("Privy Solana wallet is not ready");

      const { signedTransaction } = await signTransaction({
        transaction: transaction.serialize({ requireAllSignatures: false, verifySignatures: false }),
        wallet: signingWallet,
        chain: solanaChain,
      });
      return Transaction.from(signedTransaction);
    },
    [settledWallets, signTransaction, solanaChain],
  );

  const signPrivyMessage = useCallback(
    async (message: Uint8Array) => {
      const signingWallet = findEmbeddedWallet(await settledWallets());
      if (!signingWallet) throw new Error("Privy Solana wallet is not ready");

      const { signature } = await signMessage({ message, wallet: signingWallet });
      // The wrapping key is argon2id(PIN, sha256(signature)), so a short or
      // re-encoded signature silently produces a key nobody can reproduce and
      // the member is told their PIN is wrong. Fail here, where it is legible.
      if (signature.length !== 64) {
        throw new Error(`Unexpected Privy signature length: ${signature.length}`);
      }
      // Development only, and free: it compares against signatures this browser
      // already made rather than asking for another one.
      const drift = checkSignatureStability({
        signer: signingWallet.address,
        message,
        signature,
      });
      if (drift) console.error(drift);
      return signature;
    },
    [settledWallets, signMessage],
  );

  // Whatever the member would recognise. Privy links several account types and
  // any of them can be the one they remember signing in with.
  const accountLabel = useMemo(() => {
    if (!user) return null;
    return (
      user.email?.address ??
      user.google?.email ??
      user.farcaster?.username ??
      user.wallet?.address ??
      null
    );
  }, [user]);

  const value = useMemo<PrivySolanaAuthority>(
    () => ({
      enabled: true,
      // privyReady alone: walletsReady stays false for the whole of a logged-out
      // session, and `ready` is read to decide whether `authenticated` can be
      // trusted yet. Wallet availability is ensureWallet's problem.
      ready: privyReady,
      authenticated,
      isModalOpen,
      publicKey,
      login: openLogin,
      ensureWallet,
      signTransaction: signPrivyTransaction,
      signMessage: signPrivyMessage,
      accountLabel,
      accountId: user?.id ?? null,
      logout,
    }),
    [
      authenticated,
      isModalOpen,
      ensureWallet,
      openLogin,
      privyReady,
      publicKey,
      signPrivyTransaction,
      signPrivyMessage,
      accountLabel,
      user,
      logout,
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
        // Privy's own passkey is deliberately absent, and the reason is the
        // picker rather than our stored credential id, which Privy never
        // touches. Its passkey would be a second discoverable credential on
        // this same RP, and `authenticate` sends an empty allowCredentials
        // whenever this browser has no stored id — the cross-device path, where
        // a synced passkey is chosen from the OS list. A second entry there is
        // one the member can pick, and picking it derives a different PRF seed:
        // a different, empty vault, reported as no error at all.
        loginMethods: ["email", "wallet"],
        appearance: {
          theme: "dark",
          accentColor: "#14F195",
          // Both lines are load-bearing. Privy's default walletList is the Ethereum
          // set (metamask, rainbow, wallet_connect), and any of those names makes the
          // SDK fetch the WalletConnect registry from explorer-api.walletconnect.com —
          // blocked by our CSP, and `externalWallets.walletConnect.enabled` does not
          // gate that fetch. Naming only detected Solana wallets keeps the request
          // from ever being made, and matches what this app can actually sign with.
          walletChainType: "solana-only",
          walletList: ["detected_solana_wallets"],
        },
        embeddedWallets: {
          solana: { createOnLogin: "users-without-wallets" },
          showWalletUIs: true,
        },
        externalWallets: {
          // WalletConnect is off: nothing here uses it (Solana externals arrive via
          // wallet-standard), and leaving it on makes the SDK fetch its registry from
          // explorer-api.walletconnect.com — a CSP violation on the page that holds
          // spending keys, and an origin not worth allowing for an unused path.
          walletConnect: { enabled: false },
          solana: { connectors: toSolanaWalletConnectors() },
        },
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
