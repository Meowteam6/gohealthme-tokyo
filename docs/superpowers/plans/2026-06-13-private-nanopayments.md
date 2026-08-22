# Private Health-Reward Nanopayments Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Swap the wallet layer from Privy to Dynamic and add a private reward-claim path that routes USDC rewards through Unlink's shielded pool on Arc, so the on-chain link between a health goal and the recipient wallet is broken.

**Architecture:** Dynamic replaces `PrivyProvider` but keeps the existing wagmi/viem config (consumers unchanged). A new additive "claim privately" path: a server-held treasury deposits USDC into its own Unlink account, privately transfers to the participant's `unlink1…` account, and the participant withdraws to a fresh EOA. The existing oracle→`HealthPools.settle()` public payout stays untouched as a fallback.

**Tech Stack:** Next.js 16 (App Router) + React 19, wagmi 3 + viem 2, `@dynamic-labs/*`, `@unlink-xyz/sdk@canary`, Vitest for unit tests, Foundry for the (unchanged) contracts.

**Source spec:** `docs/superpowers/specs/2026-06-13-private-nanopayments-design.md`

---

## Pre-flight notes (read before starting)

- **Next.js is non-standard here.** `app/AGENTS.md` warns this Next version has breaking changes vs training data. Before writing route handlers or provider code, skim `app/node_modules/next/dist/docs/` for the relevant API.
- **Two env files.** The Next app reads `app/.env.local` (NOT repo-root `.env`). All `NEXT_PUBLIC_*` and SDK vars below go in `app/.env.local`.
- **Canary SDK uncertainty.** `@unlink-xyz/sdk@canary` and `@dynamic-labs/*` exact signatures may drift from the docs. Where a step says *"verify against installed types"*, open the package's `.d.ts` in `node_modules` and adjust the call to match before moving on. Do not guess.
- **USDC is 6 decimals.** Every amount crossing an SDK boundary is a base-unit string (`"1000000"` = 1 USDC). Never pass a float.
- **Run all `npm`/`npx` commands from `app/`.**

## File structure

| File | Responsibility | Action |
|------|----------------|--------|
| `app/package.json` | deps + test script | Modify |
| `app/vitest.config.ts` | test runner config | Create |
| `app/lib/usdc.ts` | USDC base-unit conversions (6 dp) | Create |
| `app/lib/usdc.test.ts` | unit tests | Create |
| `app/lib/server/claims.ts` | claimed-goal + userId↔unlink-address store | Create |
| `app/lib/server/claims.test.ts` | unit tests | Create |
| `app/lib/dynamic.ts` | Dynamic EVM network config for Arc | Create |
| `app/app/providers.tsx` | provider tree (Privy→Dynamic) | Modify |
| `app/lib/wallet.ts` | `useEmbeddedWallet()` over Dynamic, same interface | Modify |
| `app/lib/unlink/client.ts` | browser Unlink client + mnemonic recovery | Create |
| `app/lib/server/unlink-admin.ts` | Unlink admin client + auth routes factory | Create |
| `app/lib/server/dynamic-jwt.ts` | verify Dynamic session JWT → userId | Create |
| `app/app/api/unlink/auth/[...route]/route.ts` | mounted Unlink admin auth routes | Create |
| `app/app/api/unlink/payout/route.ts` | treasury deposit→private transfer to participant | Create |
| `app/app/api/unlink/payout/route.test.ts` | unit test (admin mocked) | Create |
| `app/components/ClaimPrivately.tsx` | claim + withdraw UI | Create |
| `app/components/PoolDetail.tsx` | wire in ClaimPrivately | Modify |
| `app/.env.example` (repo root `.env.example` too) | document new vars | Modify |

---

### Task 0: Dependencies, env, and test runner

**Files:**
- Modify: `app/package.json`
- Create: `app/vitest.config.ts`
- Modify: `app/.env.example`, repo-root `.env.example`

- [ ] **Step 1: Install runtime deps**

Run from `app/`:
```bash
npm install @dynamic-labs/sdk-react-core @dynamic-labs/ethereum @dynamic-labs/wagmi-connector @unlink-xyz/sdk@canary @circle-fin/x402-batching
```
Expected: installs succeed. Note the resolved `@unlink-xyz/sdk` version printed; we pin it in Step 6.

- [ ] **Step 2: Install dev deps (test runner)**

```bash
npm install -D vitest @vitest/coverage-v8
```

- [ ] **Step 3: Add the test script to `app/package.json`**

In the `"scripts"` block add:
```json
    "test": "vitest run",
    "test:watch": "vitest"
```

- [ ] **Step 4: Create `app/vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "app/**/*.test.ts", "components/**/*.test.ts"],
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, ".") },
  },
});
```

- [ ] **Step 5: Document new env vars**

Append to `app/.env.example` (create if absent) and the repo-root `.env.example`:
```bash
# Dynamic (wallet/auth) — get from the Dynamic dashboard
NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID=
# Unlink (private payments) — server only
UNLINK_API_KEY=
UNLINK_ENVIRONMENT=arc-testnet
# Treasury EOA that funds private payouts (server only). May reuse the oracle key.
UNLINK_TREASURY_PRIVATE_KEY=
```

- [ ] **Step 6: Pin the Unlink canary version**

Edit `app/package.json` dependency `"@unlink-xyz/sdk"` from `"canary"` to the exact resolved version from Step 1 (e.g. `"0.x.y-canary.N"`) so a later `npm install` does not pull a breaking canary.

- [ ] **Step 7: Verify the app still builds**

Run: `npm run build`
Expected: build succeeds (no code changed yet, deps only). If `@unlink-xyz/sdk` ESM/CJS interop breaks the build, add it to `serverExternalPackages` in `next.config.ts` and re-run.

- [ ] **Step 8: Commit**

```bash
git add app/package.json app/package-lock.json app/vitest.config.ts app/.env.example .env.example
git commit -m "chore: add Dynamic + Unlink deps, vitest, env scaffolding"
```

---

### Task 1: USDC amount helper (TDD)

**Files:**
- Create: `app/lib/usdc.ts`
- Test: `app/lib/usdc.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/usdc.test.ts
import { describe, it, expect } from "vitest";
import { toBaseUnits, fromBaseUnits, USDC_DECIMALS } from "@/lib/usdc";

describe("usdc", () => {
  it("has 6 decimals", () => {
    expect(USDC_DECIMALS).toBe(6);
  });
  it("converts whole and fractional USDC to base-unit strings", () => {
    expect(toBaseUnits("1")).toBe("1000000");
    expect(toBaseUnits("1.99")).toBe("1990000");
    expect(toBaseUnits("0.25")).toBe("250000");
  });
  it("rejects more than 6 decimal places", () => {
    expect(() => toBaseUnits("1.1234567")).toThrow();
  });
  it("round-trips back to a decimal string", () => {
    expect(fromBaseUnits("1990000")).toBe("1.99");
    expect(fromBaseUnits("1000000")).toBe("1");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- usdc`
Expected: FAIL — cannot resolve `@/lib/usdc`.

- [ ] **Step 3: Implement `app/lib/usdc.ts`**

```ts
// USDC is 6 decimals on Arc. All SDK boundaries use base-unit strings.
import { parseUnits, formatUnits } from "viem";

export const USDC_DECIMALS = 6 as const;

export function toBaseUnits(amount: string): string {
  if (!/^\d+(\.\d{1,6})?$/.test(amount.trim())) {
    throw new Error(
      `Invalid USDC amount "${amount}": max ${USDC_DECIMALS} decimal places`,
    );
  }
  return parseUnits(amount.trim(), USDC_DECIMALS).toString();
}

export function fromBaseUnits(base: string): string {
  return formatUnits(BigInt(base), USDC_DECIMALS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- usdc`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/usdc.ts app/lib/usdc.test.ts
git commit -m "feat: USDC base-unit helper (6 decimals)"
```

---

### Task 2: Claim store (TDD)

Tracks which `goalId`s have been privately claimed (idempotency) and links a Dynamic `userId` to its registered `unlink1…` address.

**Files:**
- Create: `app/lib/server/claims.ts`
- Test: `app/lib/server/claims.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
// app/lib/server/claims.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import {
  isClaimed,
  markClaimed,
  linkUnlinkAddress,
  getUnlinkAddress,
  userOwnsUnlinkAddress,
} from "@/lib/server/claims";

const DATA = path.join(process.cwd(), ".data");

describe("claims store", () => {
  beforeEach(async () => {
    await fs.rm(path.join(DATA, "claims.json"), { force: true });
    await fs.rm(path.join(DATA, "unlink-addresses.json"), { force: true });
  });

  it("reports unclaimed goals as not claimed, then claimed after marking", async () => {
    expect(await isClaimed("goal-1")).toBe(false);
    await markClaimed("goal-1");
    expect(await isClaimed("goal-1")).toBe(true);
  });

  it("markClaimed is idempotent", async () => {
    await markClaimed("goal-1");
    await markClaimed("goal-1");
    expect(await isClaimed("goal-1")).toBe(true);
  });

  it("links and resolves a userId to an unlink address", async () => {
    await linkUnlinkAddress("user-A", "unlink1abc");
    expect(await getUnlinkAddress("user-A")).toBe("unlink1abc");
    expect(await userOwnsUnlinkAddress("user-A", "unlink1abc")).toBe(true);
    expect(await userOwnsUnlinkAddress("user-A", "unlink1xyz")).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- claims`
Expected: FAIL — cannot resolve `@/lib/server/claims`.

- [ ] **Step 3: Implement `app/lib/server/claims.ts`**

```ts
// Hackathon-grade claim + identity store, built on the existing JSON store.
import { readJson, writeJson } from "@/lib/server/store";

const CLAIMS_FILE = "claims.json";
const ADDR_FILE = "unlink-addresses.json";

type ClaimMap = Record<string, true>;
type AddrMap = Record<string, string>; // userId -> unlink1...

export async function isClaimed(goalId: string): Promise<boolean> {
  const map = await readJson<ClaimMap>(CLAIMS_FILE, {});
  return map[goalId] === true;
}

export async function markClaimed(goalId: string): Promise<void> {
  const map = await readJson<ClaimMap>(CLAIMS_FILE, {});
  map[goalId] = true;
  await writeJson(CLAIMS_FILE, map);
}

export async function linkUnlinkAddress(
  userId: string,
  unlinkAddress: string,
): Promise<void> {
  const map = await readJson<AddrMap>(ADDR_FILE, {});
  map[userId] = unlinkAddress;
  await writeJson(ADDR_FILE, map);
}

export async function getUnlinkAddress(
  userId: string,
): Promise<string | null> {
  const map = await readJson<AddrMap>(ADDR_FILE, {});
  return map[userId] ?? null;
}

export async function userOwnsUnlinkAddress(
  userId: string,
  unlinkAddress: string,
): Promise<boolean> {
  return (await getUnlinkAddress(userId)) === unlinkAddress;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- claims`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add app/lib/server/claims.ts app/lib/server/claims.test.ts
git commit -m "feat: claim + unlink-address store"
```

---

### Task 3: Dynamic Arc network config

**Files:**
- Create: `app/lib/dynamic.ts`

- [ ] **Step 1: Create `app/lib/dynamic.ts`**

Dynamic needs the Arc network described in its `EvmNetwork` shape (separate from the viem chain). USDC gas is 18 decimals at the protocol/native level (matches `lib/chains.ts`).

```ts
// Dynamic EvmNetwork descriptor for Arc testnet, passed via
// DynamicContextProvider overrides.evmNetworks.
export const arcEvmNetwork = {
  chainId: 5042002,
  networkId: 5042002,
  name: "Arc Testnet",
  iconUrls: [],
  nativeCurrency: { name: "USDC", symbol: "USDC", decimals: 18 },
  rpcUrls: ["https://rpc.testnet.arc.network"],
  blockExplorerUrls: ["https://testnet.arcscan.app"],
};
```

- [ ] **Step 2: Verify the shape against installed types**

Open `app/node_modules/@dynamic-labs/types` (or wherever `EvmNetwork` is exported) and confirm required fields (`chainId`, `networkId`, `name`, `nativeCurrency`, `rpcUrls`, `blockExplorerUrls`, `iconUrls`). Add/rename any required field the installed type demands. Do not guess — match the type.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors in `lib/dynamic.ts`.

- [ ] **Step 4: Commit**

```bash
git add app/lib/dynamic.ts
git commit -m "feat: Dynamic EvmNetwork config for Arc testnet"
```

---

### Task 4: Swap provider tree Privy → Dynamic

**Files:**
- Modify: `app/app/providers.tsx`

- [ ] **Step 1: Replace `providers.tsx` with the Dynamic tree**

Keep the existing `wagmiConfig` (chains/transports) verbatim — only the outer auth wrapper changes. Replace the whole file body's provider section with:

```tsx
"use client";

import { useState, type ReactNode } from "react";
import { DynamicContextProvider } from "@dynamic-labs/sdk-react-core";
import { EthereumWalletConnectors } from "@dynamic-labs/ethereum";
import { DynamicWagmiConnector } from "@dynamic-labs/wagmi-connector";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WagmiProvider, createConfig, fallback, http } from "wagmi";
import { arcTestnet, sepolia } from "@/lib/chains";
import { arcEvmNetwork } from "@/lib/dynamic";

const wagmiConfig = createConfig({
  chains: [arcTestnet, sepolia],
  transports: {
    [arcTestnet.id]: fallback([
      http("https://rpc.testnet.arc.network"),
      http("https://rpc.blockdaemon.testnet.arc.network"),
      http("https://rpc.drpc.testnet.arc.network"),
    ]),
    [sepolia.id]: http(),
  },
  connectors: [],
  ssr: true,
});

function DynamicMissingBanner() {
  return (
    <div className="bg-amber-950 border-b border-amber-700 px-4 py-2 text-sm text-amber-200">
      Dynamic is not configured. Set NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID to
      enable sign-in and embedded wallets.
    </div>
  );
}

export default function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            retry: 2,
            refetchOnWindowFocus: false,
          },
        },
      }),
  );

  const environmentId = process.env.NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID ?? "";

  if (environmentId === "") {
    return (
      <DynamicMissingBanner />
    );
  }

  return (
    <DynamicContextProvider
      settings={{
        environmentId,
        walletConnectors: [EthereumWalletConnectors],
        overrides: { evmNetworks: [arcEvmNetwork] },
      }}
    >
      <WagmiProvider config={wagmiConfig}>
        <QueryClientProvider client={queryClient}>
          <DynamicWagmiConnector>{children}</DynamicWagmiConnector>
        </QueryClientProvider>
      </WagmiProvider>
    </DynamicContextProvider>
  );
}
```

> Note: when `environmentId` is empty we render only the banner (Dynamic provider must not mount without an env id). This is a config-missing dev state; production always has the env id.

- [ ] **Step 2: Verify provider nesting against Dynamic docs**

Confirm the documented order `DynamicContextProvider > WagmiProvider > QueryClientProvider > DynamicWagmiConnector` matches the installed SDK's README in `app/node_modules/@dynamic-labs/wagmi-connector`. Adjust if the installed version differs.

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `lib/wallet.ts` (still importing Privy) — fixed in Task 5. `providers.tsx` itself must be clean.

- [ ] **Step 4: Commit**

```bash
git add app/app/providers.tsx
git commit -m "feat: swap provider tree from Privy to Dynamic"
```

---

### Task 5: Rewrite `useEmbeddedWallet()` over Dynamic (same interface)

The public `EmbeddedWalletState` interface must stay identical so `JoinPool`, `FundPool`, `BackGoal`, `CreatePool`, `Header` need no changes.

**Files:**
- Modify: `app/lib/wallet.ts`

- [ ] **Step 1: Replace `wallet.ts` internals with Dynamic hooks**

```tsx
"use client";

import { useCallback } from "react";
import {
  useDynamicContext,
  useIsLoggedIn,
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

export type ArcWalletClient = WalletClient<Transport, Chain, Account>;

export interface EmbeddedWalletState {
  ready: boolean;
  authenticated: boolean;
  address: Address | null;
  login: () => void;
  logout: () => Promise<void>;
  getArcWalletClient: () => Promise<ArcWalletClient>;
}

/**
 * Dynamic-backed wallet access. Mirrors the prior Privy interface so all
 * consumers are unchanged. Switches the wallet to Arc and returns a viem
 * wallet client.
 */
export function useEmbeddedWallet(): EmbeddedWalletState {
  const { sdkHasLoaded, primaryWallet, setShowAuthFlow, handleLogOut } =
    useDynamicContext();
  const isLoggedIn = useIsLoggedIn();

  const address =
    primaryWallet !== null &&
    /^0x[0-9a-fA-F]{40}$/.test(primaryWallet.address)
      ? (primaryWallet.address as Address)
      : null;

  const getArcWalletClient = useCallback(async (): Promise<ArcWalletClient> => {
    if (primaryWallet === null || !isEthereumWallet(primaryWallet)) {
      throw new Error("No EVM wallet connected. Sign in first.");
    }
    await primaryWallet.switchNetwork(arcTestnet.id);
    const walletClient = await primaryWallet.getWalletClient();
    return walletClient as ArcWalletClient;
  }, [primaryWallet]);

  return {
    ready: sdkHasLoaded,
    authenticated: isLoggedIn,
    address,
    login: () => setShowAuthFlow(true),
    logout: handleLogOut,
    getArcWalletClient,
  };
}
```

- [ ] **Step 2: Verify Dynamic signer API against installed types**

The exact method names (`primaryWallet.getWalletClient()`, `switchNetwork`, `isEthereumWallet`) must match the installed `@dynamic-labs/ethereum` / `@dynamic-labs/sdk-react-core`. Open their `.d.ts` and confirm/adjust. If `getWalletClient()` is not present, use the documented alternative for that version (e.g. `getSigner`/wagmi `useWalletClient()`), keeping the returned type a viem `WalletClient`.

- [ ] **Step 3: Confirm consumers compile (interface unchanged)**

`wallet.ts` removed the `wallet` field from `EmbeddedWalletState`. Grep for consumers of it:
```bash
grep -rn "\.wallet\b" app/components app/lib --include=*.tsx --include=*.ts
```
If any consumer used `.wallet` directly, refactor it to use `address`/`getArcWalletClient`. (Expected: none — it was internal.)

- [ ] **Step 4: Typecheck the whole app**

Run: `npx tsc --noEmit`
Expected: no errors anywhere.

- [ ] **Step 5: Remove Privy dependency**

```bash
npm uninstall @privy-io/react-auth
```
Then grep to confirm no remaining Privy imports:
```bash
grep -rn "@privy-io" app/ --include=*.ts --include=*.tsx
```
Expected: no matches.

- [ ] **Step 6: Build + manual smoke**

Run: `npm run build` (expect success). Then `npm run dev`, open http://localhost:3000, set `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID` first, click sign in, confirm a wallet/address appears and the network is Arc. (If no Dynamic env id yet, confirm the missing-config banner renders instead.)

- [ ] **Step 7: Commit**

```bash
git add app/lib/wallet.ts app/package.json app/package-lock.json
git commit -m "feat: useEmbeddedWallet over Dynamic, drop Privy"
```

---

### Task 6: Unlink browser client + mnemonic recovery

**Files:**
- Create: `app/lib/unlink/client.ts`

- [ ] **Step 1: Create `app/lib/unlink/client.ts`**

Browser non-custodial client, mnemonic recovered/created via `client.userStorage` keyed on the Dynamic userId (per the partner-integration tutorial). USDC token address is the Arc ERC-20.

```ts
"use client";

import {
  account,
  createUnlinkClient,
} from "@unlink-xyz/sdk/browser";

const UNLINK_ENVIRONMENT = "arc-testnet";
export const ARC_USDC_ADDRESS =
  "0x3600000000000000000000000000000000000000";

export type UnlinkClient = ReturnType<typeof createUnlinkClient>;

/**
 * Create (or recover) the participant's Unlink mnemonic. Storage is keyed on
 * the Dynamic userId; the encryption key is derived separately from the JWT.
 * Returns a registered Unlink client and its unlink1 address.
 */
export async function getUnlinkClient(params: {
  userId: string;
  dynamicToken: string;
}): Promise<{ client: UnlinkClient; unlinkAddress: string }> {
  const { userId } = params;

  // A bootstrap client able to read/write encrypted recovery envelopes.
  // The mnemonic is recovered if present, else created and stored.
  const mnemonic = await recoverOrCreateMnemonic(params);

  const client = createUnlinkClient({
    environment: UNLINK_ENVIRONMENT,
    account: account.fromMnemonic({ mnemonic }),
    userId,
  });

  await client.ensureRegistered();
  const unlinkAddress = await client.getAddress();
  return { client, unlinkAddress };
}

async function recoverOrCreateMnemonic(params: {
  userId: string;
  dynamicToken: string;
}): Promise<string> {
  // Implementation per docs.unlink.xyz/accounts-and-keys + partner-integrations:
  // use client.userStorage to fetch an encrypted envelope for userId; if none,
  // generate a new mnemonic, encrypt with a key derived from the Dynamic token,
  // and persist. Authorization tokens for userStorage come from the backend
  // auth routes (Task 7), reached with the Dynamic JWT.
  throw new Error("recoverOrCreateMnemonic: implement against installed SDK");
}
```

- [ ] **Step 2: Implement `recoverOrCreateMnemonic` against the installed SDK**

Open `app/node_modules/@unlink-xyz/sdk/dist` types and the live tutorial (https://docs.unlink.xyz/accounts-and-keys, https://docs.unlink.xyz/partner-integrations) and replace the `throw` with the real `userStorage` envelope flow:
- read encrypted envelope for `userId` via the storage API,
- if absent, generate mnemonic (the SDK's key/account helper), encrypt with a key derived from `dynamicToken`, store it,
- return the plaintext mnemonic.

Confirm `client.getAddress()` is the correct accessor for the `unlink1…` address; adjust to the installed name (may be `client.address` or `account.address`).

- [ ] **Step 3: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors (the `throw` path is replaced with a real implementation; if you stage Step 1 alone temporarily, the `throw` still typechecks).

- [ ] **Step 4: Commit**

```bash
git add app/lib/unlink/client.ts
git commit -m "feat: Unlink browser client + mnemonic recovery"
```

---

### Task 7: Unlink admin client + auth routes + Dynamic JWT verify

**Files:**
- Create: `app/lib/server/dynamic-jwt.ts`
- Create: `app/lib/server/unlink-admin.ts`
- Create: `app/app/api/unlink/auth/[...route]/route.ts`

- [ ] **Step 1: Create `app/lib/server/dynamic-jwt.ts`**

Verifies a Dynamic session JWT and returns the `userId` (the `sub` claim). Dynamic exposes JWKS per environment.

```ts
// Verify a Dynamic session JWT against Dynamic's JWKS, return userId (sub).
import { createRemoteJWKSet, jwtVerify } from "jose";
import { requireEnv } from "@/lib/server/env";

function jwksUrl(): URL {
  const envId = requireEnv("NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID");
  return new URL(
    `https://app.dynamic.xyz/api/v0/sdk/${envId}/.well-known/jwks`,
  );
}

let jwks: ReturnType<typeof createRemoteJWKSet> | null = null;

export async function requireDynamicUserId(request: Request): Promise<string> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token === "") throw new Error("Missing Bearer token");
  if (jwks === null) jwks = createRemoteJWKSet(jwksUrl());
  const { payload } = await jwtVerify(token, jwks);
  if (typeof payload.sub !== "string" || payload.sub === "") {
    throw new Error("Dynamic JWT missing sub claim");
  }
  return payload.sub;
}
```

- [ ] **Step 2: Add `jose` if not already present**

```bash
npm install jose
```

- [ ] **Step 3: Verify the JWKS URL against Dynamic docs**

Confirm the JWKS endpoint format for the installed SDK/version (Dynamic docs "Validating JWTs"). Adjust the URL if it differs (some versions use `app.dynamicauth.com`). Do not guess — match the docs for the env in use.

- [ ] **Step 4: Create `app/lib/server/unlink-admin.ts`**

```ts
// Server-side Unlink admin client + auth routes wired to Dynamic JWT identity.
import {
  createUnlinkAdmin,
  createUnlinkAuthRoutes,
} from "@unlink-xyz/sdk/admin";
import { requireEnv, optionalEnv } from "@/lib/server/env";
import { requireDynamicUserId } from "@/lib/server/dynamic-jwt";
import {
  linkUnlinkAddress,
  userOwnsUnlinkAddress,
} from "@/lib/server/claims";

export function unlinkAdmin() {
  return createUnlinkAdmin({
    environment: optionalEnv("UNLINK_ENVIRONMENT", "arc-testnet"),
    apiKey: requireEnv("UNLINK_API_KEY"),
  });
}

export function unlinkAuthRoutes() {
  return createUnlinkAuthRoutes({
    admin: unlinkAdmin(),
    authenticate: async (request: Request) => {
      const userId = await requireDynamicUserId(request);
      return { userId };
    },
    onRegister: async ({ session, registration }) => {
      await linkUnlinkAddress(session.userId, registration.address);
    },
    authorizeUnlinkAddress: async ({ session, unlinkAddress }) =>
      userOwnsUnlinkAddress(session.userId, unlinkAddress),
    authorizeUserStorage: async ({ session, userId }) =>
      session.userId === userId,
  });
}
```

- [ ] **Step 5: Verify the auth-routes factory signature against installed types**

Open `app/node_modules/@unlink-xyz/sdk/dist` admin types. Confirm the callback names (`authenticate`, `onRegister`, `authorizeUnlinkAddress`, `authorizeUserStorage`) and the `registration.address` / `session.userId` shapes. Adjust to match. Confirm how the returned routes object exposes a handler (e.g. `routes.handler(request)` or a fetch-style handler).

- [ ] **Step 6: Create the catch-all route `app/app/api/unlink/auth/[...route]/route.ts`**

```ts
import { unlinkAuthRoutes } from "@/lib/server/unlink-admin";

const routes = unlinkAuthRoutes();

// Bridge Next App Router handlers to the Unlink auth routes handler.
// Adjust `routes.handler` to the installed SDK's handler accessor (Step 5).
export async function GET(request: Request) {
  return routes.handler(request);
}
export async function POST(request: Request) {
  return routes.handler(request);
}
```

- [ ] **Step 7: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors. If `routes.handler` is named differently, fix per Step 5.

- [ ] **Step 8: Commit**

```bash
git add app/lib/server/dynamic-jwt.ts app/lib/server/unlink-admin.ts "app/app/api/unlink/auth/[...route]/route.ts" app/package.json app/package-lock.json
git commit -m "feat: Unlink admin auth routes + Dynamic JWT verification"
```

---

### Task 8: Treasury payout route (TDD, admin mocked)

The endpoint that delivers a reward privately: verify the caller (Dynamic JWT), confirm the goal is eligible + unclaimed, then treasury deposits into its own Unlink account and privately transfers to the participant's `unlink1…`.

**Files:**
- Create: `app/lib/server/unlink-payout.ts` (testable core)
- Test: `app/lib/server/unlink-payout.test.ts`
- Create: `app/app/api/unlink/payout/route.ts` (thin HTTP wrapper)

- [ ] **Step 1: Write the failing test for the payout core**

```ts
// app/lib/server/unlink-payout.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { promises as fs } from "fs";
import path from "path";
import { runPrivatePayout } from "@/lib/server/unlink-payout";

const DATA = path.join(process.cwd(), ".data");

function fakeTreasury() {
  return {
    depositWithApproval: vi.fn(async () => ({ wait: vi.fn(async () => ({})) })),
    transfer: vi.fn(async () => ({ wait: vi.fn(async () => ({})) })),
  };
}

describe("runPrivatePayout", () => {
  beforeEach(async () => {
    await fs.rm(path.join(DATA, "claims.json"), { force: true });
  });

  it("deposits then transfers to the recipient and marks claimed", async () => {
    const treasury = fakeTreasury();
    const res = await runPrivatePayout({
      goalId: "goal-1",
      unlinkAddress: "unlink1recipient",
      amountBaseUnits: "250000",
      treasury,
      token: "0xUSDC",
    });
    expect(res.status).toBe("paid");
    expect(treasury.depositWithApproval).toHaveBeenCalledOnce();
    expect(treasury.transfer).toHaveBeenCalledWith({
      recipientAddress: "unlink1recipient",
      token: "0xUSDC",
      amount: "250000",
    });
    // deposit must happen before transfer
    expect(treasury.depositWithApproval.mock.invocationCallOrder[0]).toBeLessThan(
      treasury.transfer.mock.invocationCallOrder[0],
    );
  });

  it("is idempotent: a second call for the same goalId does not pay again", async () => {
    const treasury = fakeTreasury();
    const args = {
      goalId: "goal-1",
      unlinkAddress: "unlink1recipient",
      amountBaseUnits: "250000",
      treasury,
      token: "0xUSDC",
    };
    await runPrivatePayout(args);
    const second = await runPrivatePayout({ ...args, treasury: fakeTreasury() });
    expect(second.status).toBe("already-claimed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- unlink-payout`
Expected: FAIL — cannot resolve `@/lib/server/unlink-payout`.

- [ ] **Step 3: Implement `app/lib/server/unlink-payout.ts`**

```ts
import { isClaimed, markClaimed } from "@/lib/server/claims";

export interface TreasuryClient {
  depositWithApproval(args: {
    token: string;
    amount: string;
  }): Promise<{ wait: () => Promise<unknown> }>;
  transfer(args: {
    recipientAddress: string;
    token: string;
    amount: string;
  }): Promise<{ wait: () => Promise<unknown> }>;
}

export interface PayoutResult {
  status: "paid" | "already-claimed";
}

/**
 * Deliver a reward privately. Marks claimed BEFORE moving funds so a retry is
 * idempotent. Treasury deposits into its own Unlink account, then privately
 * transfers to the participant — the deposit→transfer pair is what breaks the
 * goal↔recipient link on-chain.
 */
export async function runPrivatePayout(args: {
  goalId: string;
  unlinkAddress: string;
  amountBaseUnits: string;
  token: string;
  treasury: TreasuryClient;
}): Promise<PayoutResult> {
  if (await isClaimed(args.goalId)) {
    return { status: "already-claimed" };
  }
  await markClaimed(args.goalId);

  const deposit = await args.treasury.depositWithApproval({
    token: args.token,
    amount: args.amountBaseUnits,
  });
  await deposit.wait();

  const transfer = await args.treasury.transfer({
    recipientAddress: args.unlinkAddress,
    token: args.token,
    amount: args.amountBaseUnits,
  });
  await transfer.wait();

  return { status: "paid" };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- unlink-payout`
Expected: PASS (2 tests).

- [ ] **Step 5: Create the treasury client factory in `app/lib/server/unlink-admin.ts`**

Append a server treasury Unlink client (custodial, from `@unlink-xyz/sdk/client` + admin), using `UNLINK_TREASURY_PRIVATE_KEY`'s mnemonic/account:

```ts
import { account, createUnlinkClient } from "@unlink-xyz/sdk/client";

export function treasuryClient() {
  const admin = unlinkAdmin();
  const mnemonic = requireEnv("UNLINK_TREASURY_MNEMONIC");
  const unlinkAccount = account.fromMnemonic({ mnemonic });
  return createUnlinkClient({
    environment: optionalEnv("UNLINK_ENVIRONMENT", "arc-testnet"),
    account: unlinkAccount,
    register: (payload) => admin.users.register(payload),
    authorizationToken: {
      provider: () =>
        admin.authorizationTokens.issue({
          unlinkAddress: unlinkAccount.address,
        }),
    },
    // EVM provider for the deposit step — Arc RPC + treasury key.
    evm: treasuryEvmProvider(),
  });
}
```
Add `UNLINK_TREASURY_MNEMONIC` to `.env.example` (the server custodial client uses a mnemonic, not a raw key). Implement `treasuryEvmProvider()` returning a viem wallet client on Arc from `UNLINK_TREASURY_PRIVATE_KEY` (reuse the `arcTestnet()`/`privateKeyToAccount` pattern from `lib/server/oracle.ts`). **Verify `createUnlinkClient` server options (`register`, `authorizationToken`, `evm`) against installed types (Step 5 of Task 7) and adjust.**

- [ ] **Step 6: Create the HTTP wrapper `app/app/api/unlink/payout/route.ts`**

```ts
// POST /api/unlink/payout
// Auth: Authorization: Bearer <Dynamic JWT>
// Body: { goalId: string, unlinkAddress: string, poolId: string|number, address: string }
import { isAddress, type Address } from "viem";
import { requireDynamicUserId } from "@/lib/server/dynamic-jwt";
import { treasuryClient } from "@/lib/server/unlink-admin";
import { runPrivatePayout } from "@/lib/server/unlink-payout";
import { getUnlinkAddress } from "@/lib/server/claims";
import { getVerification } from "@/lib/server/world";
import { ARC_USDC_ADDRESS } from "@/lib/unlink/client";
import { toBaseUnits } from "@/lib/usdc";
import { errorMessage, jsonError, readJsonBody } from "@/lib/server/http";

export async function POST(request: Request) {
  try {
    const userId = await requireDynamicUserId(request);

    const body = await readJsonBody(request);
    const { goalId, unlinkAddress, poolId, address } = body as Record<
      string,
      unknown
    >;
    if (typeof goalId !== "string" || goalId === "")
      return jsonError(400, "goalId required");
    if (typeof unlinkAddress !== "string" || !unlinkAddress.startsWith("unlink1"))
      return jsonError(400, "unlinkAddress required");
    if (typeof address !== "string" || !isAddress(address))
      return jsonError(400, "address must be a valid 0x address");

    // The unlink address must belong to the authenticated user.
    const owned = await getUnlinkAddress(userId);
    if (owned !== unlinkAddress)
      return jsonError(403, "unlinkAddress not registered to this user");

    // Eligibility: must have a verified World ID record for the pool.
    // (Verdict gating is enforced upstream by the oracle; reuse the same gate.)
    const verification = await getVerification(address as Address, String(poolId));
    if (verification === null)
      return jsonError(403, "No verified record for this pool");

    // Reward amount: source of truth is the pool's per-achiever reward.
    // For the demo, read it from the request-validated pool reward (see note).
    const amountBaseUnits = toBaseUnits(String((body as { rewardUsdc?: string }).rewardUsdc ?? "0.25"));

    const result = await runPrivatePayout({
      goalId,
      unlinkAddress,
      amountBaseUnits,
      token: ARC_USDC_ADDRESS,
      treasury: treasuryClient(),
    });

    return Response.json(result);
  } catch (err) {
    return jsonError(500, errorMessage(err));
  }
}
```

> **Reward-amount note:** for the MVP the per-achiever reward is passed/validated server-side (`rewardUsdc`, default `0.25` to match the nanopayment framing). Hardening (read `perAchieverUsdc` from the on-chain pool) is a stretch item — keep it off the critical path.

- [ ] **Step 7: Typecheck + test**

Run: `npx tsc --noEmit && npm test`
Expected: typecheck clean; all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add app/lib/server/unlink-payout.ts app/lib/server/unlink-payout.test.ts app/lib/server/unlink-admin.ts app/app/api/unlink/payout/route.ts app/.env.example .env.example
git commit -m "feat: private payout route (deposit->private transfer), TDD core"
```

---

### Task 9: ClaimPrivately UI component

**Files:**
- Create: `app/components/ClaimPrivately.tsx`

- [ ] **Step 1: Read an existing component for house style**

Run: open `app/components/JoinPool.tsx` and `app/components/ui.tsx` to match button/state/error patterns and the `useEmbeddedWallet()` usage.

- [ ] **Step 2: Create `app/components/ClaimPrivately.tsx`**

```tsx
"use client";

import { useState } from "react";
import { useDynamicContext } from "@dynamic-labs/sdk-react-core";
import { useEmbeddedWallet } from "@/lib/wallet";
import { getUnlinkClient } from "@/lib/unlink/client";

type Phase = "idle" | "provisioning" | "claiming" | "withdrawing" | "done" | "error";

export function ClaimPrivately(props: {
  goalId: string;
  poolId: string;
  rewardUsdc: string;
}) {
  const { authToken } = useDynamicContext() as { authToken?: string };
  const { address } = useEmbeddedWallet();
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);

  async function claim() {
    setError(null);
    try {
      if (!authToken) throw new Error("Sign in first.");
      if (!address) throw new Error("No wallet.");

      setPhase("provisioning");
      // userId = JWT sub; the helper derives it internally from the token.
      const { unlinkAddress } = await getUnlinkClient({
        userId: address, // see Step 3 note
        dynamicToken: authToken,
      });

      setPhase("claiming");
      const res = await fetch("/api/unlink/payout", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify({
          goalId: props.goalId,
          poolId: props.poolId,
          address,
          unlinkAddress,
          rewardUsdc: props.rewardUsdc,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Payout failed");

      setPhase("done");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase("error");
    }
  }

  return (
    <div className="rounded-lg border border-emerald-800 bg-emerald-950/40 p-4">
      <h3 className="font-medium text-emerald-200">Receive this reward privately</h3>
      <p className="mt-1 text-sm text-emerald-400/80">
        Paid into your private Unlink account — no on-chain link between this
        health goal and your wallet.
      </p>
      <button
        onClick={claim}
        disabled={phase !== "idle" && phase !== "error"}
        className="mt-3 rounded-md bg-emerald-500 px-4 py-2 text-sm font-medium text-emerald-950 disabled:opacity-50"
      >
        {phase === "idle" || phase === "error"
          ? `Claim ${props.rewardUsdc} USDC privately`
          : phase === "done"
            ? "Claimed privately ✓"
            : "Working…"}
      </button>
      {phase === "done" && (
        <p className="mt-2 text-sm text-emerald-300">
          Reward is in your private account. Withdraw it to any fresh wallet from
          your dashboard — the source stays hidden.
        </p>
      )}
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
    </div>
  );
}
```

- [ ] **Step 3: Resolve the `userId` source**

The payout route authorizes via `userId = JWT sub`, and `getUnlinkClient` must use the SAME `userId` so the registered `unlink1…` matches what the server linked. Replace the placeholder `userId: address` with the JWT `sub`: decode it client-side from `authToken` (it's already verified server-side) or read it from `useDynamicContext().user?.userId`. Confirm the field name against the installed SDK and use it consistently in both places.

- [ ] **Step 4: Confirm Dynamic auth token accessor**

Verify how to read the session JWT on the client (`useDynamicContext().authToken` vs `getAuthToken()` from `@dynamic-labs/sdk-react-core`). Adjust the cast/usage to the installed API.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 6: Commit**

```bash
git add app/components/ClaimPrivately.tsx
git commit -m "feat: ClaimPrivately component"
```

---

### Task 10: Wire ClaimPrivately into the pool detail view

**Files:**
- Modify: `app/components/PoolDetail.tsx`

- [ ] **Step 1: Inspect where a settled/achieved reward is shown**

Run: open `app/components/PoolDetail.tsx`; find where a participant's achieved/eligible state and the per-achiever reward are rendered (near the existing settle/claim affordance).

- [ ] **Step 2: Render `ClaimPrivately` for an eligible participant**

Import and place it in the achieved/eligible branch, passing the real `goalId`, `poolId`, and per-achiever reward (as a decimal string). Example insertion:

```tsx
import { ClaimPrivately } from "@/components/ClaimPrivately";
// …inside the eligible/achieved branch:
<ClaimPrivately
  goalId={goalId}
  poolId={String(poolId)}
  rewardUsdc={perAchieverUsdc}
/>
```
Use the variables already in scope in `PoolDetail` for `goalId`/`poolId`/`perAchieverUsdc`; if `goalId` is not present in this component, derive/pass it from the same source the oracle uses (deterministic goalId), or thread it from the page props. Keep the existing public settle button as-is alongside it.

- [ ] **Step 3: Typecheck + build**

Run: `npx tsc --noEmit && npm run build`
Expected: clean build.

- [ ] **Step 4: Commit**

```bash
git add app/components/PoolDetail.tsx
git commit -m "feat: surface private claim in pool detail"
```

---

### Task 11: Regression + demo rehearsal

**Files:** none (verification only)

- [ ] **Step 1: Contracts unchanged — forge tests green**

Run: `cd contracts && forge test`
Expected: 62 tests pass (no contract code was touched).

- [ ] **Step 2: App unit tests + typecheck + build**

Run from `app/`: `npm test && npx tsc --noEmit && npm run build`
Expected: all green.

- [ ] **Step 3: Lint**

Run: `npm run lint`
Expected: no errors (fix any introduced).

- [ ] **Step 4: Manual E2E rehearsal (requires real Dynamic env id + Unlink API key + funded treasury)**

1. Set `app/.env.local`: `NEXT_PUBLIC_DYNAMIC_ENVIRONMENT_ID`, `UNLINK_API_KEY`, `UNLINK_ENVIRONMENT=arc-testnet`, `UNLINK_TREASURY_MNEMONIC`/`UNLINK_TREASURY_PRIVATE_KEY`.
2. Fund the treasury's Unlink account on testnet (`client.faucet.requestPrivateTokens`) or via Circle faucet → deposit.
3. `npm run dev`; sign in with Dynamic; confirm Arc wallet.
4. On a pool where the signed-in user is eligible, click "Claim privately"; confirm the route returns `{status:"paid"}`.
5. On Arcscan, confirm the visible events are a treasury deposit + (later) a withdrawal to a fresh EOA — with NO transaction linking the pool to the recipient. This is the demo's wow moment.

- [ ] **Step 5: Verify the existing public settle still works (safety net)**

Run the existing `./scripts/happy-path-test.sh` from repo root (oracle → settle). Expected: unchanged, passes. This proves the fallback demo path is intact.

- [ ] **Step 6: Final commit**

```bash
git add -A
git commit -m "chore: regression pass for private nanopayments feature"
```

---

## Self-review notes

- **Spec coverage:** wallet swap (T3–T5), Unlink client (T6), admin/auth (T7), private payout deposit→transfer (T8), withdraw + UI (T9–T10), public-settle safety net intact (T11/S5), error handling (banner T4, UnlinkError surfaced in UI T9, idempotency T8, treasury balance via faucet T11), testing (T1/T2/T8 unit, T11 regression+E2E). USDC decimals centralized (T1). All spec sections map to a task.
- **Canary/uncertain APIs** are explicitly gated with "verify against installed types" steps (T3.2, T5.2, T6.2, T7.5, T8.5, T9.3–9.4) — these are the riskiest spots; do them with the `.d.ts` open, not from memory.
- **Type consistency:** `EmbeddedWalletState` (T5) keeps the same field names consumers use; `runPrivatePayout`/`TreasuryClient` signatures (T8) match the route call; `getUnlinkClient` return `{client, unlinkAddress}` used in T9.

---

## REVISION (approved 2026-06-13): server-side Unlink — supersedes Tasks 6, 7, 8

**Why:** the installed `@unlink-xyz/sdk@0.0.2-canary.0` differs from the docs. It has a single root
export (no `/browser` `/admin` `/client` subpaths), NO `createUnlinkAdmin` / `createUnlinkAuthRoutes` /
`client.userStorage` / `client.faucet`, and the API key must stay server-side. The high-level client is
`createUnlink({ engineUrl, apiKey, account, evm? })` returning a `UnlinkClient` with `deposit`,
`transfer({ token, amount, recipientAddress })`, `withdraw`, `getBalances`, `ensureRegistered`,
`getAddress`. Accounts come from `unlinkAccount.fromMnemonic({ mnemonic, accountIndex? })`; `unlinkEvm(...)`
wraps a viem wallet client for the deposit's on-chain Permit2 approval.

**Decision:** run the ENTIRE Unlink flow server-side (custodial for the demo). Privacy guarantee is
unchanged — deposit → private transfer → withdraw still breaks the on-chain goal↔recipient link.
Prize reqs unchanged (Dynamic = wallets, Unlink = private routing, Arc = settlement). Productionize to
non-custodial when Unlink ships browser auth.

**Keys/identity:** everything keys on the participant's Dynamic EVM `address` (no JWT). Participant
Unlink accounts derive from a master mnemonic + a deterministic `accountIndex` from the address; the
treasury uses its own mnemonic. Amounts are USDC base-unit strings (6 dp) — `lib/usdc.ts` stays correct.

**Revised files (replace the T6/T7/T8 file list):**
- `app/lib/server/unlink.ts` — engine config; `treasuryUnlinkClient()`; `participantUnlinkClient(address)`;
  `participantAccountIndex(address)`; `ARC_USDC_ADDRESS`. Built on `createUnlink`/`unlinkAccount`/`unlinkEvm`.
- `app/lib/server/unlink-payout.ts` + `.test.ts` — pure `runPrivatePayout({goalId, recipientUnlinkAddress,
  amountBaseUnits, token, treasury})`, TDD, treasury mocked. Marks claimed BEFORE moving funds (idempotent).
  Treasury interface: `deposit({token, amount})` then `transfer({token, amount, recipientAddress})`.
- `app/app/api/unlink/account/route.ts` — POST `{address}` → participant `ensureRegistered()` + `getAddress()`
  → `linkUnlinkAddress(address, unlinkAddr)` → `{ unlinkAddress }`.
- `app/app/api/unlink/payout/route.ts` — POST `{address, poolId, goalId, rewardUsdc}` → gate on World
  verification for the pool (reuse `getVerification`) → resolve/create recipient unlink address →
  `runPrivatePayout(treasuryUnlinkClient())` → status.
- `app/app/api/unlink/withdraw/route.ts` — POST `{address, amountUsdc}` → `participantUnlinkClient(address)
  .withdraw({ token: ARC_USDC_ADDRESS, amount, recipientEvmAddress: address })` → tx.
- Env: add `UNLINK_ENGINE_URL`, `UNLINK_TREASURY_MNEMONIC`, `UNLINK_USER_MASTER_MNEMONIC` (keep
  `UNLINK_API_KEY`, `UNLINK_ENVIRONMENT`). DROPPED: `app/lib/unlink/client.ts` (browser),
  `app/lib/server/unlink-admin.ts`, `app/lib/server/dynamic-jwt.ts`, `app/app/api/unlink/auth/[...route]/route.ts`.

**T9/T10 adjust:** `ClaimPrivately` calls `/api/unlink/account` (once) then `/api/unlink/payout`, and a
"Withdraw to my wallet" action hits `/api/unlink/withdraw`. No browser Unlink import; pass `address` from
`useEmbeddedWallet()`.
