# Private Health-Reward Nanopayments — Dynamic + Unlink on Arc

**Date:** 2026-06-13
**Project:** GoHealthMe (ETHGlobal New York 2026)
**Target prize:** "Build an app combining Dynamic + Unlink for private nanopayments on Arc." ($2,000 / $1,000)
**Approach chosen:** A (private reward claim) built with B's safety net (existing public settle stays intact).

## Problem & use case

GoHealthMe pays USDC rewards on Arc for verified health goals. The killer privacy flaw is on the
**payout side**: a public USDC settlement from "the diabetes-management pool" to wallet `0xABC`
**doxxes a health condition** — anyone reading Arc can build a health profile from who-got-paid-by-which-pool.

The use case: **private health-reward nanopayments.** Rewards are delivered into a participant's
**Unlink private account** and withdrawn to a fresh wallet, so there is **no on-chain link between a
health goal and the recipient**. Framed as nanopayments: small per-verified-action micro-rewards that
are individually private. This is the exact PHI-leak problem the product exists to solve.

## Verified facts (from docs — do not re-derive)

- **Unlink** ([docs.unlink.xyz](https://docs.unlink.xyz/)) is a **shielded-pool privacy contract** for
  ERC-20s: encrypted UTXO notes + Groth16 zk-proofs. Already deployed/hosted — no contract to deploy.
- Unlink **supports Arc Testnet** (chain id 5042002) as a first-class env, string `"arc-testnet"`.
  (Also base-sepolia, ethereum-sepolia, monad-testnet.) Custom/arbitrary chains are NOT supported.
- SDK: `npm i @unlink-xyz/sdk@canary`. Browser non-custodial client (`@unlink-xyz/sdk/browser`),
  server admin (`@unlink-xyz/sdk/admin`), custodial client (`@unlink-xyz/sdk/client`).
- Unlink primitives and what each reveals:
  - `depositWithApproval({ token, amount })` — credits **only the depositor's own** private account
    (NO deposit-on-behalf). Public: sender EOA, amount, token.
  - `transfer({ recipientAddress: "unlink1…", token, amount })` — **fully private** (sender, recipient,
    amount all hidden by the proof). This is where unlinkability is created.
  - `withdraw({ recipientEvmAddress, token, amount })` — public: destination EOA + amount; hides source.
  - `execute(...)` — spend private funds in an external EVM call.
  - Amounts are base units (USDC = 6 decimals; `"1000000"` = 1 USDC).
- First-party tutorial that is exactly this prize: [partner-integrations](https://docs.unlink.xyz/partner-integrations.md)
  (Dynamic sign-in → derive Unlink account from Dynamic JWT → fund → withdraw to fresh EOA → x402 on Arc).
- **Dynamic** ([docs.dynamic.xyz](https://docs.dynamic.xyz/)) = wallet/auth infra. Packages:
  `@dynamic-labs/sdk-react-core @dynamic-labs/ethereum @dynamic-labs/wagmi-connector`.
  Provider nesting: `DynamicContextProvider > WagmiProvider > QueryClientProvider > DynamicWagmiConnector`.
  Custom EVM nets via `overrides.evmNetworks` (+ `getOrMapViemChain`); wagmi hooks auto-sync to the
  Dynamic-logged-in wallet, so existing wagmi/viem consumers are unchanged.

## Architecture

Two isolated changes; existing oracle→`HealthPools.settle()` public payout stays 100% intact (safety net).

```
Dynamic (sign-in + embedded wallet, JWT)
   │
   ├─ wagmi/viem (unchanged) → HealthPools.sol on Arc   ← EXISTING public settle (safety net)
   │
   └─ Unlink private-claim layer (NEW, additive):
        participant derives Unlink account (browser, from Dynamic JWT) → unlink1… address
        treasury (server) deposits USDC → its OWN private account
        treasury TRANSFERS privately → participant unlink1…   ← link broken here (zk, fully hidden)
        participant WITHDRAWS → fresh EOA                      ← hides source; no goal↔wallet link
```

The source↔destination unlinkability comes from the **private transfer** between two Unlink accounts
(deposits credit only the depositor, so the treasury deposits into itself, then privately transfers).

## Components

### Wallet layer (swap Privy → Dynamic)
- `app/app/providers.tsx` — replace `PrivyProvider` with `DynamicContextProvider` (settings:
  `environmentId`, `walletConnectors: [EthereumWalletConnectors]`, `overrides.evmNetworks` registering
  Arc 5042002 + Sepolia) → existing `WagmiProvider` (config unchanged) → `QueryClientProvider` →
  `DynamicWagmiConnector`.
- `app/lib/wallet.ts` — rewrite `useEmbeddedWallet()` internals to source `address`, `authenticated`,
  `login`/`logout`, `getArcWalletClient()` from Dynamic (`useDynamicContext` / `primaryWallet`).
  **Public interface stays identical** → `JoinPool`, `FundPool`, `BackGoal`, `CreatePool`, `Header`
  need zero changes.
- Packages: add `@dynamic-labs/*` (3 above); remove `@privy-io/react-auth`.
- Fix `app/lib/chains.ts` USDC nativeCurrency decimals quirk (18 → confirm vs ERC-20 6) since Dynamic
  reads the chain shape.

### Private-claim layer (new)
- `app/lib/unlink/client.ts` — browser Unlink client factory:
  `createUnlinkClient({ environment: "arc-testnet", account: account.fromMnemonic(...), userId })`,
  `ensureRegistered()`. Mnemonic derived/recovered via `client.userStorage` keyed on Dynamic userId
  (partner tutorial's `recoverOrCreateUnlinkMnemonic`).
- `app/lib/server/unlink-admin.ts` — `createUnlinkAdmin({ environment, apiKey })` +
  `createUnlinkAuthRoutes(...)` behind Dynamic JWT verification (`onRegister` links userId → unlink1…).
- `app/api/unlink/auth/[...route]/route.ts` — mounted admin auth routes (registration + storage authz).
- `app/api/unlink/payout/route.ts` — server endpoint: given a verified, settled `goalId` + participant
  `unlink1…`, the treasury `depositWithApproval` into its own account then `transfer` privately to the
  participant. Marks goalId claimed (idempotent).
- `components/ClaimPrivately.tsx` — UI: "Receive this reward privately"; shows private balance; offers
  withdraw to a fresh EOA.

### Contracts
- `HealthPools.sol` — **no structural change.** Treasury funded by the existing settle flow (or
  pre-funded). Optional cuttable extra: per-participant `payoutMode` flag for demo clarity.

## Data flow (private claim)

1. **Sign in** — Dynamic → Arc embedded wallet + JWT (`sub` = userId).
2. **Provision Unlink account** (first claim only) — browser derives/recovers mnemonic via
   `client.userStorage`, `ensureRegistered()` → `unlink1…`. Backend links `userId → unlink1…`.
3. **Earn** — existing pipeline unchanged: evidence → judge → verdict → `goalId`; verdict gates eligibility.
4. **Claim privately** — POST `/api/unlink/payout` `{ goalId, unlinkAddress }`. Server verifies Dynamic
   JWT, confirms goalId settled-eligible + unclaimed, then treasury `depositWithApproval` →
   `transfer` to `unlink1…`. Marks claimed.
5. **Withdraw** — participant `withdraw({ recipientEvmAddress: <fresh EOA>, token: usdc, amount })`.
   Chain shows: treasury↔pool funding (no participant) + an unrelated withdrawal EOA. Goal↔recipient
   link hidden by the zk transfer.

## Error handling
- Dynamic not configured → keep existing "not configured" banner; gate private features; public settle works.
- Unlink unreachable / proof timeout (`UnlinkError`) → retry; fallback to public `settle()` ("claim to public wallet").
- Double-claim → mark `goalId` claimed before transfer; idempotent retry.
- Treasury underfunded → preflight balance check; clear error + faucet pointer
  (`client.faucet.requestPrivateTokens`, testnet).
- Decimals → all USDC in 6-decimal base units; centralize in one helper.

## Testing
- Contracts unchanged → existing 62 forge tests must stay green (regression gate).
- `/api/unlink/payout` unit test (Unlink admin mocked): JWT verify → eligibility → deposit-then-transfer
  ordering → claimed-flag idempotency.
- Wallet swap smoke: `useEmbeddedWallet()` interface unchanged → consumers compile; manual sign-in → Arc tx.
- E2E manual rehearsal: sign in → earn → claim privately → withdraw to fresh EOA → show two unlinkable
  on-chain events.

## Scope guardrails
- **MVP must-have:** Dynamic swap (identical wallet interface); Unlink provision + treasury
  deposit→private-transfer payout; withdraw-to-fresh-EOA; public settle untouched.
- **Stretch:** private backing/self-stake; `payoutMode` UI; nanopayment framing (many small per-action
  transfers); x402 spend (`@circle-fin/x402-batching`) as a "spend your private reward" beat.
- **Never on critical path:** anything that can break the proven public settle.

## Open items / risks
- Confirm the "3-pick cap" in HANDOFF.md does not force dropping a submitted partner (Unlink+Dynamic is
  a separate sponsor bounty).
- Need an Unlink API key (`UNLINK_API_KEY`) and a Dynamic `environmentId` — add to `app/.env.local`.
- Treasury private-account funding on testnet via Unlink faucet; confirm Arc USDC availability.
- `@unlink-xyz/sdk@canary` is a canary build — pin a working version once integrated.
- Verify exact Dynamic signer retrieval API (`primaryWallet.getWalletClient()` vs connector) during impl.
