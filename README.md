# GoHealthMe

Put money on yourself. Stake test USDC on your own sleep or workout goal, your wearable proves whether you did it, and SPOTTER, the settlement agent, pays the players who hit the moment the run ends. Raw health data never touches the chain; only the verdict does.

**Beta on Base Sepolia, test USDC only: https://gohealthme-tokyo.vercel.app**

This repository is the **ETHGlobal Tokyo 2026** build (Sep 25-27, 2026), entered on the **Continuity track**. Partners this weekend: World (IDKit, World ID for Agents), ENS (ENSv2 on Sepolia), Intercepta (payout screening).

## Continuity (ETHGlobal Tokyo 2026)

**Pre-existing work.** Everything up to and including commit `a86387d` (2026-09-14) existed before the event: the V3 Base Sepolia pilot with self-staked commitment pools, three wearable providers behind one join gate, SPOTTER the settlement agent, handles and the feed. Lineage: `gohealthme` (ETHGlobal New York 2026, Chainlink Confidential AI Attester winner) to `arbiterpay` (Circle Agentic Economy, SPOTTER's own wallet) to `gohealthme-base` (V3 pilot) to this repo.

**Built at the event.** Every commit after `a86387d` on `main`: 321 commits at `90231c2`, small and dated, so `git log a86387d..main` is the honest diff. Grouped:

### World

- **IDKit, prove you are one human, at the join.** Character creation step 2. `@worldcoin/idkit` 4.3.0 with the World ID 4.0 RP-signed request flow: the server mints a signed `rp_context` on tap, the proof's signal is bound to the wallet, and the nullifier is bound one human to one wallet, so one human is one entry. `app/components/world/ProveHuman.tsx`, `app/lib/server/world/verify.ts`, `human.ts`, `require-human.ts` (the run and evidence routes refuse an unproven wallet before any spend). Merge `e253125`.
- **Any World App credential, no Orb gate.** Orb, NFC passport or My Number Card through 4.0, Device level as the 3.0 fallback; Selfie Check dropped after it failed in a live test. `app/lib/world/credentials.ts`, commits `b0cc6d2`, `db65e9e`.
- **World ID for Agents, at the payout.** SPOTTER's run loop stops at an AUTHORIZE gate: it asks the achiever to confirm, the human completes IDKit against the registered `settle` action with signal `<goalId>:<attempt>`, the server validates the proof and consumes the nullifier once per payout, and only then is the pass recorded and settled. Declined, expired and cancelled each write nothing on chain and show as real states with a retry. `app/lib/server/agent/run.ts` (fenced `world-agents` block), `approval.ts`, `approval-provider.ts`, `app/app/api/agent/approval/{request,complete,status}`, `app/components/world/HumanApprovalCard.tsx`. Merge `6d1954c`, signal binding `446671f`.
- **Live in production, not mocked.** The production deployment runs `WORLD_VERIFY_MODE=live` and `WORLD_APPROVAL_MODE=world` against a Production app and registered RP in the World Developer Portal. Both mock modes are refused when `VERCEL_ENV=production` (`app/lib/server/world/config.ts`, `app/lib/server/agent/approval-provider.ts`, commit `ccc6e40`, merge `cb1955b`); mock exists for tests, local runs and previews only. Prove-human was driven on a phone with a real World App credential on 2026-09-26. The payout confirmation runs the same provider and is covered end to end by `app/app/api/agent/approval/routes.test.ts`; as of 2026-09-27 06:00 JST no V4 run had settled yet, so it had not been exercised on a live payout.

### ENS (ENSv2 on Ethereum Sepolia)

- **`gohealthme.eth` on the 2026-09-15 ENSv2 Sepolia deployment**, with GoHealthMe's own UserRegistry and PermissionedResolver deployed through the VerifiableFactory and set as the name's subregistry and resolver. Bootstrap `app/scripts/ens-bootstrap.ts`, every tx in `DEPLOYMENTS.md` under "Tokyo 2026 (ENSv2 Sepolia)". Nothing is hard-coded: the app finds the registry and resolver through `ETHRegistry.getSubregistry("gohealthme")` and `getResolver("gohealthme")` (`app/lib/server/ens/client.ts`). Merge `7cbb4d7`.
- **`spotter.gohealthme.eth`, the agent's own name.** Owned by the agent with role bitmap 0 (it cannot re-point, transfer or mint), `addr(60)` the Sepolia signer, `addr(84532)` the Base settler read live from HealthPoolsV3. Enhanced Access Control grants the agent `ROLE_SET_TEXT` on exactly four receipt keys; `scripts/ens-boundary-proof.sh` proves every CAN and CANNOT row with `eth_call`.
- **Player names.** Character creation step 3 mints `<name>.gohealthme.eth` to the player's wallet with no gas for the player (`app/components/ens/EnsNameClaim.tsx`, `app/app/api/ens/claim`). Names need a verified human (`app/lib/server/ens/human-gate.ts`, commit `da0a1ec`), one human gets three picks (`ENS_NAMES_PER_HUMAN`, commit `fa9b9dd`), and a player can link a `.eth` they already own, verified on mainnet or Sepolia and re-checked hourly (`app/lib/server/ens/link.ts`, `POST /api/ens/link`). First name minted live: `andre.gohealthme.eth`.
- **Settlement receipts on a name.** After `AchieverPaid`, SPOTTER writes the Base tx, time, signer and achiever count to `pool-<id>.gohealthme.eth` (`app/lib/server/ens/receipt.ts`); the sweep reconciles any receipt that does not resolve. Reads go through the Universal Resolver with viem (`app/lib/server/ens/resolve.ts`), shown by `app/components/ens/EnsName.tsx`. Detail: `docs/ENS.md`.

### Intercepta

- **Live screening before every payout.** One quick-scan call before `recordResult(verdict=true)` (the only place a single payee can be excluded) and again before `settle()` is signed; blocked is excluded or held, unavailable holds, nothing is mocked outside tests. `app/lib/server/screening/intercepta.ts`, `gate.ts`, fenced `// --- intercepta ---` blocks in `app/lib/server/agent/spotter.ts`. Merge `d0bf585`.
- **Agent payments screened too.** The x402 seller's `payTo` is screened before `gw.pay` signs (`app/lib/server/agent/x402.ts`), with a real 402 demo seller whose payee is an OFAC SDN address (`app/app/api/screen/demo-seller`). The printed rule lands on every ledger row and on the receipt (`app/components/intercepta/PayoutScreening.tsx`).
- Live key on production, probe passed (clean wallets score 0; Lazarus SDN addresses score 100 with `sanction_address`). Detail and API feedback: `docs/INTERCEPTA.md`. As of 2026-09-27 06:00 JST the first screened real payout was still pending on the first V4 settle.

### The money model

- **The commitment model, said the same everywhere.** Everyone stakes the same amount; hit and you get your stake back plus an equal share of recorded misses plus any pot; nobody hits and everyone is refunded; no wearable data and your stake comes back; no cut on this build (`commitmentFeeBps` read from chain). Numbers come only from `app/lib/commitment.ts`; wording from `app/lib/game/commitment-copy.ts` and `app/lib/commitment-copy.ts`; the rule mirrors `HealthPoolsV3._settleCommitment`. `docs/DESIGN.md`, "The commitment model".
- **SPOTTER now records a miss, and only on evidence.** V3 only ever wrote `verdict=true`, so every miss was quietly refunded and the copy that promised a forfeit was false. V4 records `verdict=false` only on a run the miss rule covers (`app/lib/miss-rule.ts`: commitment model, wearable only, a final metric, one plain goal count), only after `periodEnd + MISS_GRACE_HOURS`, and only when the provider pinned at `periodStart` covered every local day of the run and shows the goal not met. Anything else records nothing and `settle()` refunds. `app/lib/server/agent/miss.ts`, `miss-record.ts`, the sweep's miss phase in `app/app/api/agent/sweep/route.ts`, contract tests `contracts/test/HealthPoolsV3.t.sol` (SpotterMiss). Merge `e1511cf`, review fixes `07c9925`.
- **`MISS_RULE_FROM_POOL_ID` cutoff.** Pools players joined under the "a miss is refunded" copy keep that promise; only pools at or after the cutoff can record a miss, and their run pages say which. Set to 6 on production, so pool 6 is the first judged commitment-model run. `DEPLOYMENTS.md`, "Recorded misses".
- **Per-flow money copy.** A kind chip and a miss chip on every money surface, terms before any stake, "Match my stake" and "Back me" share links, one chip-in warning per bounty model. `app/lib/game/money-flow.ts`, `money-sharing.ts`, `app/components/game/MoneyTerms.tsx`. Merge `b95878f`.

### Wearables

- **WHOOP direct plus Junction.** WHOOP OAuth with first-come seats (WHOOP's sandbox admits 10; reserved wallets never take a seat), Junction for everyone else, WHOOP straps included. `app/lib/server/wearable/whoop.ts`, `whoop-seats.ts`, `junction-provider.ts`, commit `5dd7550`.
- **Launch goals are the intersection.** A run can only be created on a goal every offered provider can verify (`LAUNCH_METRICS` in `app/lib/provider-capabilities.ts`: sleep efficiency, hours of sleep, workouts), so no player meets a run their wearable cannot prove. The steps run was cancelled and replaced for that reason (`DEPLOYMENTS.md` deploy log). Commit `9f611c7`, merge `3dbe671`.
- **Limits before the stake.** An unsynced or unreadable device is a hold with its fix, shown at pairing and in the lobby, never after a stake. `app/lib/wearable-join-gate.ts`, `app/lib/game/join-checks.ts`, merges `37dda94`, `e48146f`.
- **Gas drip for email wallets.** An email sign-in gives a plain EOA with 0 ETH, which dead-ended on every write in V3. Before the first write the treasury sends 0.0005 test ETH, capped per wallet and per day. `app/lib/server/gas-drip.ts`, `app/lib/ensure-gas.ts`, `app/app/api/gas/drip/route.ts`, merge `8eb8ab3`. First real join asserted on chain (USDC 50 to 49, pool 8 to 9).
- **Apple Health: not yet.** Hidden until the phone app ships (`APPLE_APP_AVAILABLE`, `app/lib/server/wearable/apple.ts`); the pairing branch is not merged and not part of this submission.

### The redesign: Night Shift

- Three directions were built as real rendered mocks and judged; Night Shift was picked over Riverbank (decisions log in `docs/DESIGN.md`). Tokens first: every colour is a semantic variable in `app/app/globals.css`, primitives in `app/components/ui.tsx`, SPOTTER relit for a night field in `app/public/spotter/night/` with `app/components/spotter/` (Perch, Moon, HoldCoin: hold 1.2 s to stake), page kit in `app/components/night/kit.tsx`. Merges `51a7bdf`, `6cdef4a`, `51681f9`, `90231c2`.
- The three-screen loop replaced nine sequential gates: character creation once (`app/app/character`, `app/components/game/CharacterCreation.tsx`), Lobby (`Lobby.tsx`, `RunRow.tsx`, `LockPanel.tsx`), The Run (`RunBoard.tsx`, `NightTally.tsx`), The Verdict (`VerdictStage.tsx`). Merge `9bd8011`.
- A dev-only state gallery at `/dev/states` renders every state of every screen; it is a real 404 on any deployment (`app/next.config.ts`).

### Privacy and terms

- `app/app/privacy/page.tsx` and `app/app/terms/page.tsx` rewritten to be true for V4: World nullifier binding per action, ENS names and the hourly re-check of linked names, the gas drip, what Junction and WHOOP receive, Apple not offered yet, the 120-day wearable retention sweep that now runs daily (`/api/cron/wearable-retention`, commit `43ab4cd`), the commitment model in the terms. Two false V3 claims removed. Commits `b1b43b7`, `da8c894`.

### Fixes V3 needed

- **The settle path could not pay a winner.** `HealthPoolsV3.healthVerdict()` is `0x0` (oracle-only) but SPOTTER read a verdict registry unconditionally, so a pass got recorded and settle errored. `app/lib/server/verdict.ts` now reads the pool's own `healthVerdict()` and treats `0x0` as oracle-only. Merge `411100c`.
- **The participant list.** The app called `getParticipants()`, which HealthPoolsV3 does not have, so every player list read "could not read the players". It now reads `participantList` from storage slot 7 and checks it against `participantCount` (`app/lib/contract.ts`, `app/lib/participants.test.ts`). Commit `86892dd`.
- **JST night keying.** The pass path and the miss rule read the same local-calendar window, and WHOOP workouts key to the wearer's local day, so a player east of UTC is judged on the night they actually slept. Commits `aea27fa`, `07c9925`.
- **Production refuses every mock.** `DEMO_MODE`, both World mock modes and a staging World environment are refused when `VERCEL_ENV=production`, and pointing V4 at the frozen V3 pilot address throws (`app/lib/server/env.ts`). Merge `cb1955b`.
- A human-approved claim whose tab closed is recorded by the sweep (`cf59a90`); finished and cancelled runs show the real result, the claim and the creator's leftover (merge `57b97c7`); V4 has its own Supabase schema with RLS on every table (`docs/DATABASE.md`).

Per-lane detail: `docs/LANES.md`, `docs/WORLD.md`, `docs/ENS.md`, `docs/INTERCEPTA.md`, `docs/DESIGN.md`, `docs/WEARABLES.md`. Addresses and transactions: `DEPLOYMENTS.md`, "Tokyo 2026" headings. A judge's walk: `docs/EVALUATE.md`. Stage: beta on Base Sepolia test USDC.

## How a run works

1. **Character creation, once.** Sign in (email or a Base wallet through Dynamic), prove you are one human (World IDKit), pick your name (`<name>.gohealthme.eth` on ENSv2 Sepolia, or link a `.eth` you own), pair your wearable (WHOOP direct or Junction).
2. **Lobby.** Each run is playable or locked for your wearable, with the reason and the fix, before any stake. Hold the coin to stake; email wallets get test ETH for gas first.
3. **The Run.** Night-by-night tally, who is in, time left. The wearable syncs; nothing is uploaded by hand.
4. **The Verdict.** SPOTTER reads the wearable summary off chain, decides, asks you to confirm with World ID for Agents, screens the payee through Intercepta, then records the result and settles from its Circle wallet. Hit: your stake back plus a share of recorded misses and the pot. Miss shown by your wearable, on a run that can record one: your stake goes to the players who hit. No data, or nobody hits: stake back. The receipt is written to `pool-<id>.gohealthme.eth`.
5. A cron sweep (`/api/agent/sweep`, every 2 minutes) judges misses after the grace window, records approved claims whose tab closed, and settles pools whose period ended, so a payout never waits on an open browser tab.

## Architecture

```
Next.js app on Vercel (project gohealthme-tokyo)        Dynamic wallets (email or Base)
   |  character creation: World IDKit -> ENSv2 name -> wearable pairing
   |  Lobby -> The Run -> The Verdict
   |
   +-- wearable summaries, off chain: WHOOP direct (OAuth) or Junction
   |
   +-- SPOTTER (app/lib/server/agent/): reads the summary, decides,
   |     asks the human to confirm (World ID for Agents),
   |     screens the payee (Intercepta, live),
   |     recordResult + settle from its Circle wallet,
   |     writes the receipt to pool-<id>.gohealthme.eth (ENSv2 Sepolia)
   |
   +-- HealthPoolsV3.sol on Base Sepolia: stakes, commitment split,
         refunds, AchieverPaid (money paths assert on the event, never on tx status)
```

Chains: Base Sepolia (chain 84532) for pools and test USDC; Ethereum Sepolia (chain 11155111) for ENSv2 names. State: Upstash KV for the agent ledger and approvals, Supabase (RLS on every table) for profiles, wearable days and challenges. The Chainlink CRE and Confidential AI Attester path from V1 stays in `cre/` and `contracts/src/HealthVerdict.sol`; V4 runs oracle-only and offers wearable-proven goals only.

Privacy invariant: raw health data never touches the chain. The wearable summary is read server side, SPOTTER's ledger holds the verdict, and the chain and the ENS receipt carry money facts and tx hashes only.

## Repo layout

- `contracts/` Foundry: `HealthPoolsV3.sol` (pools, one-entry dedupe, commitment settle, refunds, sweep), `HealthVerdict.sol` (V1 Chainlink registry, unused on V4), tests including `TokyoDemo.t.sol`
- `app/` Next.js App Router: the game loop, SPOTTER (`lib/server/agent/`), World (`lib/server/world/`, `components/world/`), ENS (`lib/server/ens/`, `components/ens/`, `scripts/ens-bootstrap.ts`), screening (`lib/server/screening/`), wearables (`lib/server/wearable/`)
- `scripts/` `tokyo-deploy.sh` and `tokyo-status.sh` (the V4 HealthPoolsV3 and its seeded runs), `ens-boundary-proof.sh`, `intercepta-probe.sh`
- `supabase/migrations/` V4 schema with RLS
- `docs/` lane guides, the design system, the money and wearable rules, the evaluation guide
- `cre/`, `docs/PATH-A.md`, `HANDOFF.md` V1-era Chainlink workflow and history, kept for lineage

## Run it

```
cd app && npm ci && npm run dev     # http://localhost:3000, env in app/.env.local
cd app && npm test && npx tsc --noEmit
cd contracts && forge test
```

`.env.example` lists every variable. Production refuses `DEMO_MODE`, `WORLD_VERIFY_MODE=mock` and `WORLD_APPROVAL_MODE=mock`.

## Intercepta API feedback

1. `toxicScore` has no documented range or threshold, so a score cutoff cannot be chosen without calibrating on known addresses first.
2. Quick-scan has no chain parameter, and the docs do not say which chains an address is screened across.
3. Only 200 is documented; the live 403 body and any 429 shape are what a fail-closed client needs.
4. A documented test address that returns `sanction_address` would let teams prove the blocked path without pointing at a real SDN entry.
5. Keys arrive "within a few hours"; a same-day self-serve key with a low quota would remove the one human gate in the integration.

## Team

Andre Chuabio, Nikki Hu
