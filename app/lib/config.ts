/**
 * Build-time client configuration. NEXT_PUBLIC_ values are inlined by Next
 * at build time, so these flags let components render visible configuration
 * errors instead of crashing when an integration is not wired up yet.
 */

export const DYNAMIC_CONFIGURED: boolean =
  (process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "") !== "";

/**
 * Cosmetic-only switch for recorded demo runs.
 *
 * When "1", the operator-facing configuration banners (the amber "Dynamic is
 * not configured" strip) are suppressed so demo footage shows the product, not
 * the deployment checklist. STRICTLY presentation: every behavioral fallback —
 * DYNAMIC_CONFIGURED short-circuits, the join panel's honest "Sign-in is not
 * configured" refusal — is untouched, so a demo build can never pretend an
 * integration exists. Unset everywhere except the e2e demo profile.
 */
export const DEMO_CHROME: boolean =
  (process.env.NEXT_PUBLIC_DEMO_CHROME ?? "") === "1";

/**
 * Opt-in guard against a browser wallet silently hijacking the session.
 *
 * When "1", providers.tsx installs a handleConnectedWallet handler that vetoes
 * a non-embedded (injected/external) wallet connection unless the user
 * deliberately chose to connect one (see lib/wallet-connect-intent.ts). The
 * embedded email wallet always passes. This stops Dynamic from auto-reconnecting
 * an already-approved MetaMask on page load and quietly making it the session.
 *
 * Default OFF. It is an auth-path change and this app's sign-in has regressed
 * before, so it ships inert until the auto-reconnect is reproduced in a real
 * browser. When unset the handler is never installed and provider behaviour is
 * byte-for-byte unchanged. Enabling it makes external-wallet users re-tap
 * "Connect your own wallet" after every full page reload, which is the
 * deliberate tradeoff for closing the hijack.
 */
export const GUARD_INJECTED_WALLET: boolean =
  (process.env.NEXT_PUBLIC_GUARD_INJECTED_WALLET ?? "") === "1";

/**
 * CDP (Coinbase Developer Platform) paymaster endpoint used to sponsor gas on
 * money-path transactions via EIP-5792 (wallet_sendCalls + paymasterService).
 *
 * Only a Base Account (Coinbase Smart Wallet) can be gaslessly sponsored; a
 * plain EOA (including the Dynamic email embedded wallet) has no paymaster
 * capability and always pays its own gas. When this is empty the app degrades
 * to a normal user-paid transaction and says so in the UI — it never fakes a
 * gasless send. Public by design (NEXT_PUBLIC_): a paymaster URL is not a
 * secret, but do not hardcode a real endpoint here — it is read from env so it
 * can differ per environment and be rotated without a code change.
 */
export const CDP_PAYMASTER_URL: string = (
  process.env.NEXT_PUBLIC_CDP_PAYMASTER_URL ?? ""
).trim();

/**
 * True when a CDP paymaster URL is configured. The wallet must ALSO be a smart
 * account (Base Account, or the email embedded wallet upgraded to an ERC-4337
 * smart account) for sponsorship to apply — this only reports the env half.
 */
export const PAYMASTER_CONFIGURED: boolean = CDP_PAYMASTER_URL !== "";

/**
 * Opt-in switch that upgrades the Dynamic email embedded wallet from a plain
 * Turnkey EOA to an ERC-4337 smart account (ZeroDev Kernel), so the SAME
 * sponsored money-path (EIP-5792 wallet_sendCalls + paymasterService) that
 * covers Base Account also covers email-login users. A plain EOA advertises no
 * paymasterService capability, so it can never be gaslessly sponsored; the
 * smart account does, which is what lets the CDP paymaster pay its gas.
 *
 * DASHBOARD REQUIREMENT (code alone is not enough): turning this flag on only
 * adds the ZeroDevSmartWalletConnectors connector. For the email wallet to
 * actually become a smart account, Account Abstraction / ZeroDev must ALSO be
 * enabled for this environment in the Dynamic dashboard (Wallets -> enable
 * ZeroDev, set the ZeroDev project id, and a gas policy). Without that dashboard
 * setup the connector is inert and the email wallet stays an EOA — a safe
 * degradation, not a crash.
 *
 * Default OFF. This is an auth-path change and this app's sign-in has regressed
 * before, so the default build is byte-for-byte unchanged (email = plain EOA)
 * until the dashboard side is provisioned and this flag is deliberately set.
 */
export const EMAIL_AA_ENABLED: boolean =
  (process.env.NEXT_PUBLIC_ENABLE_EMAIL_AA ?? "") === "1";
