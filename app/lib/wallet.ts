"use client";

import { useCallback } from "react";
import {
  useDynamicContext,
  useIsLoggedIn,
  useUserWallets,
} from "@dynamic-labs/sdk-react-core";
import { isEthereumWallet } from "@dynamic-labs/ethereum";
import {
  type Account,
  type Address,
  type Chain,
  type Transport,
  type WalletClient,
} from "viem";
import { arcTestnet } from "@/lib/chains";
import { DYNAMIC_CONFIGURED } from "@/lib/config";
import {
  canProveSession,
  proveRegisteredSession,
  proveWalletSession,
  userListsWallet,
} from "@/lib/session-proof";

export type ArcWalletClient = WalletClient<Transport, Chain, Account>;

export interface EmbeddedWalletState {
  ready: boolean;
  authenticated: boolean;
  address: Address | null;
  /**
   * True when the active wallet is the Dynamic-provisioned embedded wallet
   * (email sign-in, no seed phrase, no extension); false when it is an external
   * wallet the user connected themselves; null when no wallet is resolved yet.
   * Read straight off the connector, the same signal the SDK uses internally.
   */
  isEmbedded: boolean | null;
  /** The active wallet's connector name (for example "MetaMask"), or null. */
  connectorName: string | null;
  /**
   * True when Dynamic's signed-in user lists this wallet, so its session
   * token proves the wallet to the server with no prompt: every email or
   * passkey login, and a wallet login after its one session proof.
   */
  sessionProven: boolean;
  /**
   * True when the one session proof can run for this wallet: an external
   * wallet, connected only, that Dynamic would sign with. False for email and
   * passkey logins (already proven) and when Dynamic is signed in with another
   * credential (only the plain signature can run then).
   */
  sessionProofPossible: boolean;
  /**
   * Ask the wallet for the one session proof (Dynamic's authenticateUser, via
   * components/SessionProofSheet.tsx). True once proven; false on a decline,
   * a proof that cannot run, or any error. Never throws.
   */
  proveSession: () => Promise<boolean>;
  login: () => void;
  logout: () => Promise<void>;
  getArcWalletClient: () => Promise<ArcWalletClient>;
}

/**
 * Inert wallet state for builds with no Dynamic environment id. Providers
 * renders the app WITHOUT DynamicContextProvider in that case, so Dynamic
 * hooks would throw; components that call useEmbeddedWallet unguarded
 * (PoolDetail) still need a safe answer: signed out, no address.
 */
function useStubWallet(): EmbeddedWalletState {
  return {
    ready: true,
    authenticated: false,
    address: null,
    isEmbedded: null,
    connectorName: null,
    sessionProven: false,
    sessionProofPossible: false,
    proveSession: async () => false,
    login: () => {
      console.warn(
        "Dynamic is not configured (NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID unset); sign-in is unavailable.",
      );
    },
    logout: async () => {},
    getArcWalletClient: async () => {
      throw new Error(
        "Sign-in is not set up on this build yet, so no wallet can sign.",
      );
    },
  };
}

/**
 * Dynamic-backed wallet access. Prefers the primary wallet, switches it to
 * Arc testnet, and returns a viem wallet client.
 *
 * Public interface is identical to the previous wallet hook so all
 * consumers (JoinPool, FundPool, CreatePool, Header, useUsdcDeposit)
 * are untouched. The `wallet` field from the old interface was confirmed
 * unused by consumers (grep -rn ".wallet" app/components app/lib returned 0 hits).
 */
function useDynamicWallet(): EmbeddedWalletState {
  const { sdkHasLoaded, primaryWallet, setShowAuthFlow, handleLogOut, user } =
    useDynamicContext();
  const isLoggedIn = useIsLoggedIn();
  const userWallets = useUserWallets();

  // Email sign-in populates primaryWallet (the turnkey embedded wallet), but an
  // EXTERNAL wallet connected under initialAuthenticationMode "connect-only"
  // lands in userWallets while primaryWallet stays null — there is no
  // authenticated session to promote one. Reading primaryWallet alone meant a
  // MetaMask user connected successfully and the header never left "Sign in".
  // Fall back to the first connected wallet so both paths resolve identically.
  const activeWallet = primaryWallet ?? userWallets[0] ?? null;

  const address =
    activeWallet != null && /^0x[0-9a-fA-F]{40}$/.test(activeWallet.address)
      ? (activeWallet.address as Address)
      : null;

  // isEmbeddedWallet lives on the connector; it is the same boolean the SDK's
  // own isEmbeddedConnector() reads. Null until a wallet resolves so the UI can
  // tell "still loading" apart from "external".
  const connector = activeWallet?.connector ?? null;
  const isEmbedded = connector !== null ? Boolean(connector.isEmbeddedWallet) : null;
  const connectorName = connector?.name ?? null;

  // The session proof (lib/session-proof.ts). Dynamic signs it with
  // connectedWallets[0], which is userWallets[0] while nobody is signed in.
  const signedIn = user != null;
  const proofWalletAddress = signedIn ? null : (userWallets[0]?.address ?? null);
  const sessionProven = userListsWallet(user, address);
  const sessionProofPossible = canProveSession({
    address,
    isEmbedded,
    signedIn,
    proofWalletAddress,
  });
  const proveSession = useCallback(
    async (): Promise<boolean> =>
      (await proveWalletSession(address, proveRegisteredSession)) === "proven",
    [address],
  );

  const getArcWalletClient = useCallback(async (): Promise<ArcWalletClient> => {
    if (activeWallet == null || !isEthereumWallet(activeWallet)) {
      throw new Error("No EVM wallet connected. Sign in first.");
    }
    await activeWallet.switchNetwork(arcTestnet.id);
    const walletClient = await activeWallet.getWalletClient();
    return walletClient as ArcWalletClient;
  }, [activeWallet]);

  return {
    ready: sdkHasLoaded,
    // A connect-only wallet has no isLoggedIn until its one session proof
    // (sessionProven), but the app only needs a connected wallet address to
    // show it, so a connected wallet counts as authenticated.
    authenticated: isLoggedIn || address !== null,
    address,
    isEmbedded,
    connectorName,
    sessionProven,
    sessionProofPossible,
    proveSession,
    login: () => setShowAuthFlow(true),
    logout: handleLogOut,
    getArcWalletClient,
  };
}

// Selected once at module load: DYNAMIC_CONFIGURED is a build-time constant,
// so the hook identity never changes at runtime and the rules of hooks hold.
export const useEmbeddedWallet: () => EmbeddedWalletState = DYNAMIC_CONFIGURED
  ? useDynamicWallet
  : useStubWallet;
