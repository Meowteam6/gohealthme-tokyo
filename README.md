# GoHealthMe

Verified health goals with instant USDC rewards. Built at ETHGlobal New York 2026.

**Live on Arc testnet: https://gohealthme-circle.vercel.app**

Insurers already pay people for healthy behaviors — through opaque points systems and gift cards that arrive weeks later. GoHealthMe puts that model on-chain: sponsor-funded USDC pools pay out the instant a verified behavior happens, the verification runs inside a confidential enclave rather than at a company, and an agent named SPOTTER releases the money with no human in the loop.

SPOTTER is an economic actor, not a script. It holds its own Circle wallet, buys the verification each claim needs, decides, and calls `settle()` itself — under a per-claim spending cap and a daily budget, with every cent it spends printed on screen. The bounty itself is the sponsor's, released from the pool by that call; what SPOTTER pays for is gas and the checks it buys.

Partners: Arc (USDC settlement chain), Circle (agent wallet + service payments), Chainlink (CRE + Confidential AI Attester verification).

## Continuity (ETHGlobal Tokyo 2026)

This repository is the ETHGlobal Tokyo 2026 build of GoHealthMe, entered on the Continuity track.

**Pre-existing work.** Everything up to and including commit `a86387d` (2026-09-14) existed before the event: the V3 Base Sepolia pilot with self-staked commitment pools, three wearable providers (Junction, WHOOP, Apple Health) behind one join gate, SPOTTER the settlement agent, handles and the feed. Its lineage is `gohealthme` (ETHGlobal New York 2026, Chainlink Confidential AI Attester winner) to `arbiterpay` (Circle Agentic Economy) to `gohealthme-base` (V3 pilot).

**Built at the event (2026-09-25 21:00 JST onward).** Every commit after `a86387d` on `main`:

- Character creation: prove you are one human (World IDKit) replaces the closed-beta allowlist; pick your name mints an ENSv2 subname on Sepolia; pair your sensor moves the capability probe to onboarding.
- The Verdict: SPOTTER asks the achiever for a fresh human verification (World ID for Agents) before the payout is recorded, with real declined and expired paths; payouts are screened through a live Intercepta call.
- ENSv2 on Sepolia: `gohealthme.eth` namespace, `spotter.gohealthme.eth` with delegated record permissions, pool subnames carrying settlement receipts.
- The three-screen game loop (Lobby, The Run, The Verdict) replacing nine sequential gates.
- The oracle-only settle fix (the pilot could record a pass and never pay it).

Per-lane detail and setup: `docs/LANES.md`, `docs/WORLD.md`, `docs/ENS.md`, `docs/INTERCEPTA.md`, `docs/DESIGN.md`. Addresses and transactions: `DEPLOYMENTS.md`, "Tokyo 2026" headings. Stage: hackathon build, testnet only, World proofs mocked as the event specifies.

## How it works

1. Anyone funds an initiative pool (sleep, workouts, preventive care) with USDC and published bounties
2. Participants join with their wallet — one wallet, one entry, enforced by the pool contract
3. Health data is verified off-chain (wearables via Junction — WHOOP/Oura/Fitbit/Garmin — or a Chainlink Confidential AI Attester judging the goal inside a TEE); only the verdict ever touches the chain
4. SPOTTER, the settlement agent, buys the verification it needs per claim, decides, and calls `settle()` from its own Circle wallet — releasing the sponsor's pool to the achievers (optionally to a private Unlink account derived from their own wallet signature, with no on-chain link to the goal). Forfeits roll back into the pool. A cron sweep settles claims whose period ends later, so a payout never waits on someone keeping a browser tab open
5. Optional: stake on your own streak for a multiplier, back someone else's goal, or claim a small testnet USDC grant to cover Arc gas

## Architecture

```
Next.js (frontend + API) -- Dynamic embedded wallets + Unlink private payouts
   |          |
   |          +-- Junction Link (WHOOP/Oura/Fitbit/Garmin) -> health summary
   |                               |
   |              verdict path A (live demo): oracle signer
   |              verdict path B (Chainlink):
   |                Confidential AI Attester (TEE inference)
   |                  -> CRE workflow callback
   |                  -> DON-signed report
   |                  -> HealthVerdict.onReport
   |                               |
   |                               v
   |                    HealthPools.sol (Arc testnet)
   |                    USDC escrow / settle / multipliers / backing
   |                    settle() gates on HealthVerdict.canSettle() when enabled
```

Chains: Arc testnet (chain id 5042002, USDC-native) for the product and settlement. Chainlink CRE runs the off-chain goal-verification workflow. (ENS was evaluated as an identity/registry layer but dropped — Sepolia ENS was mid-migration to v2 during the event.)

Privacy invariant: raw health data never touches the chain — the Confidential AI Attester judges it inside a TEE and only the signed verdict (verified / confidence / digest) is recorded on-chain.

## Repo layout

- `contracts/` — Foundry: `HealthPools.sol` (pools, one-entry nullifier dedupe, settle, backing, multipliers) and `HealthVerdict.sol` (Chainlink verdict registry + `onReport` receiver); tests; deploy script
- `app/` — Next.js App Router: frontend and API routes (evidence, agent run, oracle signer)
- `cre/` — Chainlink CRE goal-verification workflow (Confidential AI Attester callback pattern)
- `scripts/` — `demo-reset.sh` (clean redeploy + seed) and `happy-path-test.sh` (live end-to-end proof)
- `docs/PATH-A.md` — how the oracle-signed settlement path works end to end, plus a manual QA runbook

See `HANDOFF.md` for run steps, on-chain addresses, env setup, and open items.

## Team

Andre Chuabio, Nikki Hu
