"use client";

import { useState, type ReactNode } from "react";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { ZeroDevSmartWalletConnectors } from "@dynamic-labs/ethereum-aa";
import { DynamicWagmiConnector } from "@dynamic-labs/wagmi-connector";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, fallback, http } from "wagmi";
import { arcTestnet } from "@/lib/chains";
import { DEMO_CHROME, EMAIL_AA_ENABLED, GUARD_INJECTED_WALLET } from "@/lib/config";
import { arcEvmNetwork } from "@/lib/dynamic";
import { externalConnectIntended } from "@/lib/wallet-connect-intent";
import SessionProofSheet from "@/components/SessionProofSheet";

// Optional guard against a browser wallet silently hijacking the session.
// walletsFilter hides MetaMask from the modal LIST but does not stop Dynamic
// from auto-reconnecting an already-approved injected wallet on page load; that
// reconnect lands in userWallets and becomes the session. handleConnectedWallet
// fires on both an explicit connect and a load-time reconnect (returning false
// disconnects), so this vetoes a non-embedded connection unless the embedded
// wallet is connecting or the user deliberately tapped "Connect your own wallet"
// (see lib/wallet-connect-intent.ts). The embedded email wallet always passes.
//
// Spread in ONLY when GUARD_INJECTED_WALLET is set, so the default build's
// settings object is unchanged and sign-in cannot regress from this.
const injectedWalletGuard = GUARD_INJECTED_WALLET
  ? {
      handlers: {
        handleConnectedWallet: async (wallet: {
          connector?: { isEmbeddedWallet?: boolean };
        }): Promise<boolean> =>
          Boolean(wallet.connector?.isEmbeddedWallet) ||
          externalConnectIntended(),
      },
    }
  : {};

// Wallet connectors, built once. EthereumWalletConnectors is always present
// (email OTP + external wallets). ZeroDevSmartWalletConnectors is appended ONLY
// when EMAIL_AA_ENABLED, which upgrades the email embedded wallet to an ERC-4337
// smart account (ZeroDev Kernel) whose EIP-5792 paymasterService capability lets
// the CDP paymaster sponsor its gas — the same sponsored path Base Account uses.
// Off by default, so the default build's connector set is unchanged and the
// email login UX (still just email + code) cannot regress from this. Enabling it
// also requires ZeroDev/AA to be turned on for this environment in the Dynamic
// dashboard; without that the connector is inert and email stays a plain EOA.
const walletConnectors = EMAIL_AA_ENABLED
  ? [EthereumWalletConnectors, ZeroDevSmartWalletConnectors]
  : [EthereumWalletConnectors];

// Base Sepolia only. The transports use the Base public RPCs from
// lib/chains.ts; the fork deliberately does not carry the Arc-RPC ordering
// drift the ancestor repo had here.
//
// multiInjectedProviderDiscovery: false is load-bearing. wagmi's default
// EIP-6963 discovery creates its own MetaMask connector that races Dynamic's
// connect: SyncDynamicWagmi sees no bound wallet mid-handshake, disconnects
// wagmi, and the injected connector fires wallet_revokePermissions, revoking
// the approval the player just gave (MetaMask 13.41 and later honour it, so
// the failure is deterministic). Found in V1 (gohealthme 974eb25); Dynamic's
// wagmi guide requires the flag. Dynamic is the only wallet lifecycle owner.
const wagmiConfig = createConfig({
  multiInjectedProviderDiscovery: false,
  chains: [arcTestnet],
  transports: {
    [arcTestnet.id]: fallback([
      http("https://sepolia.base.org"),
      http("https://base-sepolia-rpc.publicnode.com"),
    ]),
  },
  connectors: [],
  ssr: true,
});

// Night Shift theme for Dynamic's own sign-in modal (docs/DESIGN.md). Colours,
// fonts and radii come from the --dynamic-* custom properties set on
// .dynamic-shadow-dom in globals.css, which inherit through the shadow root.
// A custom property cannot restyle a selector, so the rules that need one
// live here: Dynamic hard-codes white text on its brand button, and the brand
// colour is the cream moon face, so the button takes the moon gradient with ink
// text. Every value is a token from globals.css, inherited through the host.
const DYNAMIC_CSS_OVERRIDES = `
.button--brand-primary {
  color: var(--accent-foreground);
  background: linear-gradient(180deg, var(--accent-top) 0%, var(--accent) 55%, var(--accent-bottom) 100%);
  box-shadow: var(--elev-moon-flat);
}
.button--brand-primary:hover:enabled { box-shadow: var(--elev-moon-flat); filter: brightness(1.04); }
.button--brand-primary .spinner { color: var(--accent-foreground) !important; }
.button--brand-primary:disabled {
  background: var(--fill-quiet);
  box-shadow: inset 0 0 0 1px var(--border);
}
.button--brand-primary:disabled, .button--brand-primary:disabled * { color: var(--haze) !important; }
`;

function DynamicMissingBanner() {
  return (
    <div className="border-b border-edge bg-surface-raised px-gutter py-2 text-sm text-warning">
      Sign-in is off on this build, so you can look around but nobody can
      play here yet.
    </div>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 30_000, retry: 2, refetchOnWindowFocus: false },
        },
      }),
  );

  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "";
  if (environmentId === "") {
    // No Dynamic env id: skip the Dynamic providers but ALWAYS render the app.
    // Wallet-dependent components each fall back via DYNAMIC_CONFIGURED, and
    // none of them mounts a Dynamic hook when it is false, so wagmi + react-query
    // are all the context the rest of the site needs. Returning only the banner
    // here used to blank the whole site and make every fallback dead code.
    // DEMO_CHROME hides the banner (an operator's checklist item, not product)
    // from recorded demo runs; every in-page fallback still renders.
    return (
      <>
        {DEMO_CHROME ? null : <DynamicMissingBanner />}
        <WagmiProvider config={wagmiConfig}>
          <QueryClientProvider client={queryClient}>
            {children}
          </QueryClientProvider>
        </WagmiProvider>
      </>
    );
  }

  return (
    <DynamicContextProvider
      theme="dark"
      settings={{
        environmentId,
        // connect-only: an external wallet connects without signing, so a
        // declined or slow signature can never fail the connect itself (it
        // used to surface as "Message signature denied" in the modal). The
        // app shows a connected wallet straight away (lib/wallet.ts resolves
        // primaryWallet ?? userWallets[0], because connect-only never
        // promotes a primaryWallet for an external wallet).
        //
        // Private reads still need proof the wallet is yours. A wallet login
        // gives it ONCE per session: SessionProofSheet (mounted below) runs
        // Dynamic's authenticateUser, the documented upgrade from
        // connect-only, after one plain line and a tap. The session token it
        // leaves lists the wallet, and lib/server/dynamic-jwt.ts accepts it
        // for every read after, reloads included. Email and passkey logins
        // already hold that token and are never asked. Where the proof cannot
        // run, lib/client-auth.ts falls back to its short-lived signature.
        // Either way no wallet opens cold: every prompt waits on the sheet's
        // one-line question, whichever surface asked.
        initialAuthenticationMode: "connect-only",
        // Surface Base Account (Coinbase Smart Wallet) as a first-class option.
        // The Coinbase connector ships inside EthereumWalletConnectors;
        // "smartWalletOnly" makes it present the passkey-backed ERC-4337 Base
        // Account flow rather than the Coinbase EOA extension. This is the
        // wallet that can be gaslessly sponsored by the CDP paymaster
        // (see lib/useGasSponsorship.ts). Email OTP is untouched and remains
        // the default path; this only adds a wallet flavor. (Coinbase must also
        // be enabled for this environment in the Dynamic dashboard for it to
        // appear in the modal.)
        coinbaseWalletPreference: "smartWalletOnly",
        // Identity shown on the Coinbase / Base Account signature prompt
        // (hosted at keys.coinbase.com). Without appLogoUrl the dialog renders a
        // BROKEN "App Logo" image, which reads as phishing on a signing screen.
        // The URL MUST be absolute and on a public, non-SSO origin: keys.coinbase
        // .com fetches it cross-origin, so a relative path, localhost, or an
        // SSO-walled *.vercel.app URL all fail. gohealthme.app is the SSO-exempt
        // custom domain and already serves this square PNG (verified 200).
        // NOTE: a logo set in the Dynamic dashboard (Design > Branding) OVERRIDES
        // this value - keep that empty or matching for this to take effect.
        appName: "GoHealthMe",
        appLogoUrl: "https://www.gohealthme.app/spotter/spotter.png",
        // EthereumWalletConnectors always; ZeroDevSmartWalletConnectors added
        // only when EMAIL_AA_ENABLED (see the walletConnectors const above).
        walletConnectors,
        // Drop MetaMask from the login modal. It is the one connector that
        // reliably fails sign-in here, and it is the only one we special-case
        // (see useMetamaskSdk below). Email and the other external wallets
        // stay. Matching on the key prefix rather than the exact "metamask"
        // string because the SDK also ships a "metamaskevm" key, and an exact
        // RemoveWallets(["metamask"]) would leave that one showing.
        walletsFilter: (wallets) =>
          wallets.filter((w) => !w.key.toLowerCase().startsWith("metamask")),
        // Dynamic's default (useMetamaskSdk: true) routes MetaMask through its
        // new multichain "connect" SDK, which establishes a MetaMask connection
        // but does NOT bind the wallet into Dynamic state in connect-only mode —
        // primaryWallet/userWallets stay empty, so the app never sees the wallet
        // and sign-in never flips. Forcing the classic injected/EIP-6963
        // connector makes primaryWallet populate reliably.
        useMetamaskSdk: false,
        overrides: { evmNetworks: [arcEvmNetwork] },
        // Don't show Dynamic's per-transaction confirmation modal for the
        // embedded (email) wallet — email-login users sign without an extra
        // popup each time. (External wallets like MetaMask still show their
        // own native prompt, which Dynamic can't suppress.)
        transactionConfirmation: { required: false },
        // Inert unless NEXT_PUBLIC_GUARD_INJECTED_WALLET is set (see above).
        ...injectedWalletGuard,
        // Theme only (see DYNAMIC_CSS_OVERRIDES above).
        cssOverrides: DYNAMIC_CSS_OVERRIDES,
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <DynamicWagmiConnector>
            {children}
            <SessionProofSheet />
          </DynamicWagmiConnector>
        </QueryClientProvider>
      </WagmiProvider>
    </DynamicContextProvider>
  );
}
