# GoHealthMe V4 (ETHGlobal Tokyo 2026, Continuity track)

Verified health goals, paid in USDC the instant a wearable proves you did the thing, and nobody sees your health data. This repo is the **ETHGlobal Tokyo 2026** build (Sep 25-27 2026, Tokyo, JST). Andre Chuabio and Nikki Hu, on site.

> **HARD RULE (Andre, 2026-09-26): this is the Continuity track, not a demo. V4 must actually work for real beta users, the same bar V3 already met.** No demo-only paths, no mock that can reach a production deployment, no hard-coded happy path, no "works for the video". Every flow is driven end to end against the real services before it is called done. Mock modes exist only for tests, local runs and preview deployments, and production code refuses them (`WORLD_VERIFY_MODE=mock` and `WORLD_APPROVAL_MODE=mock` are refused when `VERCEL_ENV=production`). Stage word stays honest: V4 is in **beta** on testnet, never "production" in copy.

> **HARD RULE (Andre, 2026-09-26): SEAMLESS UX.** Every added step must be invisible or obvious, never hidden, never a dead end. No Orb gate (any World App credential), no prompt that renders behind another modal, no refusal after a stake. If a step adds friction, it happens once per session and in plain sight, with a retry. Drive it on a real phone before calling it done.

## What this repo is

A full-history clone of `Meowteam6/gohealthme-base` (V3, the Base Sepolia pilot) taken 2026-09-25 at `a86387d` on `feat/pilot-compliance-guardrails`, renamed `main`. Everything before that commit is the existing product the Continuity track expects; everything after it is what judges score. **Commit small and often, with real messages.** Judges read the history to see what the weekend added.

Lineage: `gohealthme` (V1, ETHGlobal NY, won Chainlink Confidential AI Attester) -> `arbiterpay` (V2, Circle Agentic Economy) -> `gohealthme-base` (V3, Base pilot) -> **this repo (V4, Tokyo)**.

**Frozen for the weekend, never touch from here:** `gohealthme-base` (repo, Vercel project `gohealthme-base`, www.gohealthme.app, Base Sepolia pools on `0x66815e3A...`), `arbiterpay`, `gohealthme`. V4 deploys to a **brand-new Vercel project** (`gohealthme-tokyo`). There is deliberately no `app/.vercel/` here. Linking to any existing project would overwrite a judged or piloting build.

## Event facts and prize targets

Event brief, verified prize table, and rules: `~/Desktop/eth/docs/tokyo-event-brief.md` and `~/Desktop/eth/docs/tokyo-prizes.md`. Read them before scoping anything. Shared ledger with Nikki (backlog, done log, approval queue): MI6 `Projects/Hackathons/ETHGlobal-Tokyo-2026.md`.

Targets as of Fri night (from the prize page Nikki screenshotted):

| Partner | Track | $ | Continuity-only |
|---|---|---|---|
| World | Best Use of World ID for Agents | 5,000 | no |
| World | Best Use of IDKit | 5,000 | no |
| World | [Cont] Best Use of World ID for Agents | 2,500 | yes |
| World | [Cont] Best IDKit Use Case | 2,500 | yes |
| ENS | Best Use of ENSv2 | 6,000 | no |
| ENS | Best Integration of ENSv2 into an Existing Project | 4,000 (2k/1k/1k) | yes |

The thesis, in one line each. Do not reframe the product; add the mechanism.

- **World ID for Agents**: SPOTTER (the settlement agent in `app/lib/server/agent/`) must ask a real human to authenticate or freshly verify at the moment of a protected action (settle, payout, join). The demo must show the full journey: request, human completes it, validated result, protected action happens, AND a denied, expired or cancelled path where the action does not occur. Proofs are mocked at this event (no sandbox app); never rely on them for production.
- **IDKit**: proof-of-human at the join so one human is one entry. World ID was in V1 and was removed in V2; V4 brings it back on the current SDK, wired into `joinPool` gating and the `/c/[token]` challenge path, not a login screen.
- **ENSv2 on Sepolia**: names for pools, participants and the agent, using the parts the prize names (registry hierarchy, Enhanced Access Control, Permissioned Resolvers, record and namespace aliasing). Integration must be functional and improve the product, not cosmetic; no hard-coded values; live demo link and open-source repo at submission. Pools stay on Base Sepolia; ENS reads and writes go to Ethereum Sepolia.

## Landmines inherited from V3 (verified by the sessions that built it, 2026-09-25)

1. **FIXED 2026-09-26 (foundation lane, merged `411100c`): the settle path could not pay a winner (V3 item P19).** `HealthPoolsV3.healthVerdict()` returns `0x0` (oracle-only) but `app/lib/server/agent/spotter.ts` settle preflight and `run.ts` attester check read a verdict registry unconditionally. First achiever gets recorded, then settle errors, never auto-paid. **Fix landed:** `verdict.ts` reads the pool's own `healthVerdict()` from chain (cached 60s) and `0x0` means oracle-only in the settle preflight, the attester-role check and `recordVerdict`; `HEALTH_VERDICT_ADDRESS` is no longer required. `npm run agent:verdict-gate` prints the live read. Still owed: one live settle asserted on the USDC delta.
2. **`WEARABLE_TOKEN_KEY` fails silently.** Without it WHOOP reports itself unavailable and vanishes from the provider picker. `openssl rand -base64 32`.
3. **`NEXT_PUBLIC_ACCESS_GATE_DISABLED=1` must never reach a deployed env.** It lives in `playwright.config.ts` for the suite only. It opens the closed beta.
4. **The `e2e` CI workflow is red and pre-existing** (`agent-receipts.spec.ts`, `fail-closed.spec.ts`; mock RPC answers `getPool` with `0x`). Reproduced on `1df0e66`, before any wearable work. Do not spend Tokyo hours on it.
5. **WHOOP cannot be the demo path.** Sandbox tier, 10 members total, no review SLA. Junction is the working default (sandbox, 50 users). Apple needs a native build on a phone and has never run on one.
6. **Apple needs a database and cloning does not clone it.** Apply `supabase/migrations/20260908_wearable_days.sql` (plus its retention sweep) to whatever Supabase project V4 points at, or Apple silently has no data.
7. **`app/.env.local` in V3 wrote to production (P20).** The V4 copy has the five Upstash/KV vars stripped, so local uses the JSON file store. Do not `vercel env pull` them back in. Preview deploys of V3 share the prod database for the same reason; V4's new project must get its own KV.
8. **Both staking surfaces must use the join gate** (`app/lib/wearable-join-gate.ts`): the pool page and `/c/[token]`. Any new entry path (World-verified join included) goes through it. A pool a device cannot verify is refused at the join, before any stake.

## Rules (binding)

- **Testnet only.** Base Sepolia for pools and USDC, Ethereum Sepolia for ENSv2. No mainnet, no real money, no wager or odds language, no raw health data on chain.
- **Never touch the frozen repos or their Vercel projects** (above).
- **No secrets in git, notes, chat or artifacts.** `app/.env.local`, `contracts/.env`, `*.pem`, recovery files stay ignored. `AI_ATTRIBUTION.md` stays current.
- **No emojis. No exclamation marks in code or docs. No AI credit in commits.**
- **Money paths:** assert on a USDC delta or an emitted event. Transaction success alone proves nothing.
- **Product correctness:** an addition is judged by whether any user can now hit a dead end. Surface limits at the join, not at the claim. Before calling a lane done, name which users are worse off.
- **No stopgaps.** Ship the true fix or flag the real fix by name. A degraded path is visible in the UI and to Andre.
- **Nothing outward is sent by a session.** Submission text, tweets, DMs and forms go to the approval queue in the ledger. Andre submits.
- **Honesty ladder:** V4 is a hackathon build. V3 is a pilot. V1 won a prize. Never "live" or "production" for anything here.

## How to run

- App: `cd app && npm ci && npm run dev` -> http://localhost:3000. Env is `app/.env.local` (NOT the repo root). `NEXT_PUBLIC_*` vars must be there to reach the browser.
- Tests: `cd app && npm test` (vitest, 1154 at fork) and `npx tsc --noEmit`. Contracts: `cd contracts && forge test`.
- E2E: `npm run test:e2e` (expect the pre-existing red specs in item 4).
- Deploy: `vercel` from `app/` into the NEW `gohealthme-tokyo` project, preview first; Andre promotes. Vercel SSO protection puts every preview behind a login wall; drive QA on a URL you can actually open.
- Read `docs/WEARABLES.md` before touching wearables, `DEPLOYMENTS.md` for addresses, `HANDOFF.md` for the V1-era history (World ID sections there are history, not a wiring guide).

## Verified facts that still hold (do not re-derive)

- `multiInjectedProviderDiscovery: false` in wagmi `createConfig` (`app/app/providers.tsx`) is load-bearing: without it wagmi's own MetaMask connector races Dynamic and fires `wallet_revokePermissions` (V1 `974eb25`). It was missing from V4 until 2026-09-30 (`copy/vocab-sweep`). `initialAuthenticationMode: "connect-only"` stays. `lib/wallet.ts` resolves `primaryWallet ?? userWallets[0]`. A wallet login proves itself once per session through Dynamic's `authenticateUser` (`components/SessionProofSheet.tsx`, `lib/session-proof.ts`); the token it leaves is what `lib/server/dynamic-jwt.ts` accepts. No wallet opens until the player answers that sheet's in-page question (`confirmPrompt` in `lib/client-auth.ts`); a Verify button whose explanation is already on screen passes `confirmed` instead. The dashboard and run board read cachedOnly; `/challenges` invites, the verdict card's approval request and claim restore still ask on load, which shows the question, not a wallet popup.
- Dynamic renders into `.dynamic-shadow-dom`; a clean accessibility tree does not mean nothing rendered. Browser-automation clicks can no-op on React handlers; dispatch the full pointer sequence before declaring a control dead.
- `goalId` is read from the contract, never re-derived in the app.
- Base Sepolia HealthPoolsV3 `0x66815e3AC541eB18d01D2aed25D0D9779583D832`, USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`, oracle on chain `0xA56eAD3A32b6261bDE6C2A45495C9250084F7F2D` (DEPLOYMENTS.md lists a different oracle; chain wins). V4 may redeploy its own HealthPoolsV3 for the demo; record it in DEPLOYMENTS.md under a Tokyo heading.

## Design System

Always read `docs/DESIGN.md` (Night Shift, adopted 2026-09-26 over Riverbank) before any visual or UI decision. Fonts, colors, spacing, SPOTTER pose per state and voice are defined there. Do not deviate without Andre's approval. In QA, flag any screen that does not match it. The previous system is at git tag `pre-redesign-2026-09-26`.

## Research-first

Read this file, `~/Desktop/eth/docs/tokyo-prizes.md`, the ledger, and the specific route or contract before changing anything. Map the flow end to end (join gate -> wearable summary -> SPOTTER verdict -> human authorization -> settle -> payout) before touching any link. Expand existing code; check existing branches before implementing a fix.

## Logging

After each milestone: a row in the MI6 ledger done log with evidence (commit, tx hash, URL), and a dated entry in `~/Claude_Brain/01 - Hackathons/ETHGlobal Tokyo 2026.md` (mirrored to `~/Documents/Claude_Brain`). A session that ends without the ledger knowing what happened did not finish.
