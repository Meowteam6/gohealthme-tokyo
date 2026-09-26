# GoHealthMe deployments

## Tokyo 2026 (Base Sepolia)

ETHGlobal Tokyo 2026 (V4). A fresh instance of the unchanged `HealthPoolsV3.sol` so V4's
SPOTTER never acts on the frozen V3 pilot pools below. Deployed and seeded by
`scripts/tokyo-deploy.sh` (idempotent, forge create + cast send); state printed by
`scripts/tokyo-status.sh`. Demo flow pinned in `contracts/test/TokyoDemo.t.sol`.

**Status: NOT YET DEPLOYED.** `contracts/.env` `PRIVATE_KEY` does not parse (forge:
"expected at least one digit"; cast: "Failed to decode private key"), so the deployer
`0xc278e8e4621A0Ba02bACB6291E595ecd168A04e1` cannot sign from this machine. Fill it with the
0xc278 key (`demo-reset.sh` reads the same key as `DEPLOYER_PRIVATE_KEY` from the V3 repo's
root `.env`) and run `./scripts/tokyo-deploy.sh`; the script appends addresses and tx hashes
under "Deploy log" below.

Constructor and roles (identical to what the V3 contract reports ON CHAIN; the V3 heading
below lists two stale addresses):
- token: USDC `0x036CbD53842c5426634e7929541eC2318f3dCF7e`
- owner: deployer `0xc278e8e4621A0Ba02bACB6291E595ecd168A04e1`
- oracle: `0xA56eAD3A32b6261bDE6C2A45495C9250084F7F2D` (V3 `oracle()`; the key behind the app's
  `ORACLE_SIGNER_PRIVATE_KEY` derives to this address. `0xBceC…B9F4` below is stale.)
- authorizedSettler: `0x5BECa2BCe03ef2D8d91091744b2CfD6d1A5cd483` (V3 `authorizedSettler()`;
  SPOTTER's Circle developer-controlled EOA behind `CIRCLE_WALLET_ID`, also the commented
  `SPOTTER_WALLET_ADDRESS` in `app/.env.local`; it has 0.000196 ETH and 11 sent txs, so it is
  the wallet that has been paying gas for V3 settles. `0xf441…697d` below is stale and holds
  0 ETH.)
- healthVerdict: `0x0` (oracle-only; `settle()` needs no registry)
- commitmentFeeBps: 0 (read back after deploy), joinGateEnabled: false

Settle window (`HealthPoolsV3.settle`): settler-only for 24h after `periodEnd`, then anyone.
Gas on Base Sepolia at 0.006 gwei: a settle costs about 0.000001 ETH, so the settler's
0.000196 ETH covers well over 100 settles; no top-up needed for the demo.

Demo pools (all bountyModel 2 commitment, entry 1 USDC self-staked via `joinPool`, sponsor
pot 2 USDC pulled from the deployer at `createPool`, no proof marker = wearable floor; the
goal text sets `goalDays = 1` in `app/lib/wearable-goal.ts`; `periodStart` = the second
the script runs):

| # | initiative | goalSpec | metric / threshold | periodEnd (JST) | periodEnd (unix, UTC) |
|---|---|---|---|---|---|
| 1 | Sleep 7 hours tonight | Sleep at least 7 hours for 1 night | `sleep_hours` 7 | Sat 2026-09-26 19:00 | 1790416800 (10:00Z) |
| 2 | One workout today | Complete at least 1 workout for 1 day | `workouts` 1 | Sun 2026-09-27 08:00 | 1790463600 (Sat 23:00Z) |
| 3 | Walk 8k steps today | Walk at least 8,000 steps for 1 day | `steps` 8000 | Sun 2026-09-27 10:30 | 1790472600 (01:30Z) |

Pool 1 settles Saturday evening JST; pools 2 and 3 settle Sunday morning around the 09:00
JST submission deadline and during judging. Junction (the demo provider) reports all three
metrics. Budget: 6 USDC of the deployer's 41 USDC; the script refuses to go below 15 USDC.
Override windows with `POOL1_END`, `POOL2_END`, `POOL3_END` (unix seconds) if the run slips.

App env to switch once deployed (in `app/.env.local` and the `gohealthme-tokyo` Vercel
project; both values are the new contract address, never `0x66815e3A…`):
- `HEALTH_POOLS_ADDRESS=<Tokyo HealthPoolsV3>`
- `NEXT_PUBLIC_HEALTH_POOLS_ADDRESS=<Tokyo HealthPoolsV3>`

### Deploy log
<!-- tokyo-deploy-log -->
- 2026-09-26T00:03:49Z reuse: HealthPoolsV3 `0x0B6E8D477313599aBB746218a1AE45BAb333A12F` (seed-only run)
- 2026-09-26T00:03:49Z pool 4: **Sleep efficiency 85 tonight** | goalSpec "Sleep efficiency 85% or better for 1 night" | model 2 (commitment) | entry 1000000 uUSDC | sponsor pot 2000000 uUSDC
  - periodStart 1790381042 (Sat 2026-09-26 09:04 JST), periodEnd 1790472600 (Sun 2026-09-27 10:30 JST); settler-only until 1790559000 (Mon 2026-09-28 10:30 JST), then anyone
  - create tx https://sepolia.basescan.org/tx/0xabfd9a5cf23396b818377b72a089b7a395cfea5045be16a5984fc4c3887caca9 (on-chain id 4; replaces pool 3 "Walk 8k steps today", cancelled in tx 0xc4bc6837d2a1d826ab10b4420d85479ba6cf6bb7d02801c81b25c6bc0c5d41f3 because steps is not a launch goal)
- 2026-09-25T20:40:37Z reuse: HealthPoolsV3 `0x0B6E8D477313599aBB746218a1AE45BAb333A12F` (seed-only run)
- 2026-09-25T20:40:37Z pool 0: **Sleep 7 hours tonight** | goalSpec "Sleep at least 7 hours for 1 night" | model 2 (commitment) | entry 1000000 uUSDC | sponsor pot 2000000 uUSDC
  - periodStart 1790368846 (Sat 2026-09-26 05:40 JST), periodEnd 1790416800 (Sat 2026-09-26 19:00 JST); settler-only until 1790503200 (Sun 2026-09-27 19:00 JST), then anyone
  - create tx https://sepolia.basescan.org/tx/0x491fa335b47cdbb6606b966cb4c135cc2dfb52c40ad8cbadcf534ab10e9c54b7
- 2026-09-25T20:40:37Z pool 1: **One workout today** | goalSpec "Complete at least 1 workout for 1 day" | model 2 (commitment) | entry 1000000 uUSDC | sponsor pot 2000000 uUSDC
  - periodStart 1790368848 (Sat 2026-09-26 05:40 JST), periodEnd 1790463600 (Sun 2026-09-27 08:00 JST); settler-only until 1790550000 (Mon 2026-09-28 08:00 JST), then anyone
  - create tx https://sepolia.basescan.org/tx/0x6481c03acdda763ffbe9337861ea32765b4f29e20b609af45b45d01af6595519
- 2026-09-25T20:40:37Z pool 2: **Walk 8k steps today** | goalSpec "Walk at least 8,000 steps for 1 day" | model 2 (commitment) | entry 1000000 uUSDC | sponsor pot 2000000 uUSDC
  - periodStart 1790368851 (Sat 2026-09-26 05:40 JST), periodEnd 1790472600 (Sun 2026-09-27 10:30 JST); settler-only until 1790559000 (Mon 2026-09-28 10:30 JST), then anyone
  - create tx https://sepolia.basescan.org/tx/0x9a2c22e4d866263b758a76702688c59587be05d7c36656e760affc5b83abe0f8

### Gas drip for unsponsored wallets (Base Sepolia ETH)

Email sign-in gives a Dynamic embedded wallet that is a plain EOA with 0 ETH; the CDP
paymaster only sponsors smart accounts and `NEXT_PUBLIC_ENABLE_EMAIL_AA` stays off (it would
change wallet addresses). Before an unsponsored wallet's first money-path write, the client
(`app/lib/ensure-gas.ts`) calls `POST /api/gas/drip` (EIP-191 signed for the address), and
the treasury (`TREASURY_PRIVATE_KEY`, refilled by the `treasury-topup` cron from the CDP
faucet) sends it test ETH. Logic and caps: `app/lib/server/gas-drip.ts`. All treasury Base
sends share one store lock (`treasury-base-sender`) so drips and USDC deliveries cannot
collide on a nonce.

Optional env (server only, wei; defaults in code):

| Var | Default | Meaning |
|---|---|---|
| `GAS_DRIP_WEI` | `500000000000000` (0.0005 ETH) | sent per drip |
| `GAS_DRIP_MIN_WEI` | `200000000000000` (0.0002 ETH) | a wallet at or above this gets nothing |
| `GAS_DRIP_DAILY_BUDGET_WEI` | `30000000000000000` (0.03 ETH) | all drips together per UTC day |
| `GAS_DRIP_TREASURY_FLOOR_WEI` | `10000000000000000` (0.01 ETH) | refuse (503) below this |

Per address: at most 3 drips per UTC day (429). Refusals carry plain copy that names the
next step (wait, or the Base Sepolia ETH faucet at portal.cdp.coinbase.com/products/faucet).

## Tokyo 2026 (ENSv2 Sepolia)

ENSv2 on Ethereum Sepolia (chain 11155111), the 2026-09-15 deployment. Pools stay on Base Sepolia.
Contracts used (verified against docs.ens.domains/learn/deployments and cast code, 2026-09-26):
- UniversalResolverV2: `0x5d25c1d6acbb71b7a28aa7899618a3412a8303e3`
- ETHRegistry: `0x657ea849311d3d5823348dded7c2aaafb3ede09e`
- ETHRegistrar: `0xabe76f6c8dfced81aa5a2bb8034202a7136b94ca`
- VerifiableFactory: `0x9e726eb570beb6bceb495ab8cda7df517d4e841c`
- UserRegistryImpl: `0xa80338aaa8d23831cea25e858d1774534abb0263`
- PermissionedResolverImpl: `0x14f09fd05d4585759e54844dc9b00147131cf243`
- RootRegistry: `0x9703dbd26dab89504490994138cf2c575251a9ce`
- MockUSDC: `0x16f95d91dba7da3aca778ec053df0ff6c6a8aa8e`

Transactions written by `app/scripts/ens-bootstrap.ts` (append-only):

- 2026-09-25 deploy UserRegistry proxy (VerifiableFactory): [`0xfb70e369e7adadbfa60744217c3d4f8a55a229e5419c8284719c65340ed32d88`](https://sepolia.etherscan.io/tx/0xfb70e369e7adadbfa60744217c3d4f8a55a229e5419c8284719c65340ed32d88) (gas 178021)
  - UserRegistry proxy: `0xD6cD9911a15c43a9afD5AD4e68B92DaAbb08A299`
- 2026-09-25 deploy PermissionedResolver proxy (VerifiableFactory): [`0x362070bedc31f7c8f1bb724d5c349731954c67f6e240db79f5dbdbe40d1ce5fd`](https://sepolia.etherscan.io/tx/0x362070bedc31f7c8f1bb724d5c349731954c67f6e240db79f5dbdbe40d1ce5fd) (gas 178240)
  - PermissionedResolver proxy: `0x708A9AB8085a3fdb97a80F4BC0A2738541b7aFfc`
- 2026-09-25 mint MockUSDC for the registration fee: [`0x31ce44df3b9bf7c8ed16616423554bc8b061b5cb9bac80ba368301b2fe94f85f`](https://sepolia.etherscan.io/tx/0x31ce44df3b9bf7c8ed16616423554bc8b061b5cb9bac80ba368301b2fe94f85f) (gas 51369)
- 2026-09-25 approve ETHRegistrar for MockUSDC: [`0xe8f61b9faacc3aae77b69b7d3bb91e878823aa57d590bd0997e27ad8aafa1348`](https://sepolia.etherscan.io/tx/0xe8f61b9faacc3aae77b69b7d3bb91e878823aa57d590bd0997e27ad8aafa1348) (gas 46354)
- 2026-09-25 commit gohealthme.eth: [`0x92d7e9d11e527b1b65c51921c38885e4c7e0d9836c176d74ca0c8e10d0943c0b`](https://sepolia.etherscan.io/tx/0x92d7e9d11e527b1b65c51921c38885e4c7e0d9836c176d74ca0c8e10d0943c0b) (gas 45438)
- 2026-09-25 register gohealthme.eth (ETHRegistrar, subregistry + resolver set): [`0x247ca4b13c5734623f8b2b6550cf240f79b521d1705a2706fc5e1e141568807c`](https://sepolia.etherscan.io/tx/0x247ca4b13c5734623f8b2b6550cf240f79b521d1705a2706fc5e1e141568807c) (gas 243412)
- 2026-09-25 register spotter.gohealthme.eth to the agent, roleBitmap 0: [`0xa5b400a9ad194aa0ad7d556f0bc960549a96d5f0eed325b7d16e41d9ce88afdf`](https://sepolia.etherscan.io/tx/0xa5b400a9ad194aa0ad7d556f0bc960549a96d5f0eed325b7d16e41d9ce88afdf) (gas 125413)
- 2026-09-25 set spotter.gohealthme.eth addr(60) = agent, addr(84532) = Base settler: [`0x62b871bfe7e925e3127d54da12334a8010d5ea3b4d73c9ae7160a19e20341f24`](https://sepolia.etherscan.io/tx/0x62b871bfe7e925e3127d54da12334a8010d5ea3b4d73c9ae7160a19e20341f24) (gas 150608)
- 2026-09-25 grant the agent ROLE_SET_TEXT on 4 receipt keys (grantSetterRoles): [`0x876065748c80881a20779ba15884ba1c19baf4b557480e25ef75c383cc1b8ff2`](https://sepolia.etherscan.io/tx/0x876065748c80881a20779ba15884ba1c19baf4b557480e25ef75c383cc1b8ff2) (gas 269648)
- 2026-09-25 fund the agent with 0.003 Sepolia ETH: [`0xb55cfd67e3ee42a0ede08dcf1c42c34b37f3485242af20e578fd8a15c16ff7b5`](https://sepolia.etherscan.io/tx/0xb55cfd67e3ee42a0ede08dcf1c42c34b37f3485242af20e578fd8a15c16ff7b5) (gas 21000)

---

# GoHealthMe V3 (Base) deployments

## CURRENT — Base Sepolia (chain 84532), 2026-08-24
- HealthPoolsV3: `0x66815e3AC541eB18d01D2aed25D0D9779583D832`
- Explorer: https://sepolia.basescan.org/address/0x66815e3AC541eB18d01D2aed25D0D9779583D832
- owner (deployer): `0xc278e8e4621A0Ba02bACB6291E595ecd168A04e1` (DEPLOYER_PRIVATE_KEY)
- oracle: `0xBceC12DcF814662c4D47a7532C9CD7748116B9F4`
- authorizedSettler (SPOTTER Circle wallet): `0xf44100b58eE001736ED0267509bC2FC6bFfd697d`
- USDC: `0x036CbD53842c5426634e7929541eC2318f3dCF7e` (Base Sepolia)
- verdict registry: `0x0` (oracle-only; enable later via `setHealthVerdict` when the CRE/DON path lands)
- commitmentFeeBps (rake): 0 — pilot compliance lock, enforced by a deploy-time `require`.
- joinGateEnabled: false — closed-pilot allowlist OFF by default; the owner turns it on and allowlists the family for the closed real-money test.
- App wiring: `NEXT_PUBLIC_HEALTH_POOLS_ADDRESS` updated in local `app/.env.local`. MUST ALSO be set in Vercel production env before the app ships against this contract.
- Supersedes the prior V3 deploy `0x1928a5A6caC8f701fba2a89bf83C5BEEaFBd48d1` (had no join allowlist).

---

HealthPools (Arc testnet, chain 5042002)

## CURRENT (canonical) — gated, 2026-07-27
- HealthPools: 0xc4274eF2cBe28f77Af31b980055Cc1171818390C
- HealthVerdict: 0x9bf5e4b54361DEAca4314c1d8de3aeB30111F042
- Explorer: https://testnet.arcscan.app/address/0xc4274eF2cBe28f77Af31b980055Cc1171818390C
- Oracle signer / registry attester: 0xA56eAD3A32b6261bDE6C2A45495C9250084F7F2D
- KeystoneForwarder: 0x76c9cf548b4179F8901cda1f8623568b58215E62 (Arc testnet, from Chainlink's
  CRE forwarder directory) — HealthVerdict.onReport is LIVE, not simulation-only.
- Settlement gate: ON. settle() requires HealthVerdict.canSettle(goalId) per achiever.
- Seeded via scripts/demo-reset.sh: sleep (Dreamwell), recovery (Vitality), steps (Iron Gym),
  flu-shot [doc], screening [doc]
- Re-seed / clean slate: run ./scripts/demo-reset.sh (deploys both, wires forwarder + gate,
  syncs env, appends this file). GATE=off for the oracle-only path.

### goalId schema changed here (breaking)
goalId is now `keccak256(abi.encode(address pools, uint256 poolId, address participant,
uint64 periodStart))` — previously `keccak256(abi.encode(poolId, participant))`. The pool
contract address domain-separates the shared registry (without it, pool id 1 on two
HealthPools deployments produce the same goalId, so a verdict earned on one would satisfy
canSettle on the other); periodStart scopes a verdict to one pool period. Verdicts recorded
against the OLD registry 0x4E65…1c51 are not valid under the new formula — that registry and
every pre-2026-07-27 HealthPools are dead.

## Superseded
- 0x72D3E2E46eb7f7aC70DcaF27426D7f3aA5cf2064 (was canonical through 2026-07-27; predates the
  gate selectors — `healthVerdict()` reverts on it, so it can never consult the registry.
  Held 119.25 USDC across 15 demo pools at cutover; abandoned, not migrated.)
- 0x4527e4b2ee489282fb01fe890487149f9f1aaa46 (first deploy; had the now-shelved pushups pool)
- 0xEA46F189860AC7d07801ed25E4ABD246a3a31A02 (empty, deploy-path debug)
- HealthVerdict 0x4E65F11b65b53A328713B40C02A1BC1F421E1c51 (old goalId schema, forwarder never set)

## Demo reset 2026-06-13T02:42:17Z
- HealthPools: 0x72D3E2E46eb7f7aC70DcaF27426D7f3aA5cf2064
- Explorer: https://testnet.arcscan.app/address/0x72D3E2E46eb7f7aC70DcaF27426D7f3aA5cf2064
- Seeded: sleep (Dreamwell), recovery (Vitality), steps (Iron Gym)

## HealthVerdict registry (Tier 1 — Chainlink verdict gate) 2026-06-13
- HealthVerdict: 0x4E65F11b65b53A328713B40C02A1BC1F421E1c51
- Explorer: https://testnet.arcscan.app/address/0x4E65F11b65b53A328713B40C02A1BC1F421E1c51
- Owner: 0xc278e8e4621A0Ba02bACB6291E595ecd168A04e1 (deployer) | Attester: 0xA56eAD3A32b6261bDE6C2A45495C9250084F7F2D (oracle) | Forwarder: unset (onReport/DON path is Tier 2)
- canSettle(goalId) gates HealthPools._isAchiever when HealthPools.setHealthVerdict points here.
- NOTE: the canonical prod HealthPools (0x72D3...2064) predates the gate selectors, so it cannot consult the registry. Wiring it requires a redeploy.

## Gated HealthPools (Tier 1 gate proof instance) 2026-06-13
- HealthPools (gated): 0x5bf7CD46d1f6D8AE8889ea63C65AF54DFCB22cF4 — setHealthVerdict -> 0x4E65...1c51
- Proof: scripts/tier1-gate-proof.sh — two identical participants, only the verdict-backed one paid (2 USDC vs 0).
- Settle tx: 0x3e26d9a0e9fb71339323b7bb0754e0bca614ff392ae8cfca72bf17605c8c8c53
- Separate from prod on purpose (prod demo untouched).

## Demo reset 2026-07-27T22:21:45Z
- HealthPools: 0xc4274eF2cBe28f77Af31b980055Cc1171818390C
- Explorer: https://testnet.arcscan.app/address/0xc4274eF2cBe28f77Af31b980055Cc1171818390C
- Seeded: sleep (Dreamwell), recovery (Vitality), steps (Iron Gym),
          flu-shot [doc], screening [doc] (preventive-care, document-verified)
- HealthVerdict: 0x9bf5e4b54361DEAca4314c1d8de3aeB30111F042 (attester 0xA56eAD3A32b6261bDE6C2A45495C9250084F7F2D)
- Forwarder: 0x76c9cf548b4179F8901cda1f8623568b58215E62 (Arc KeystoneForwarder — CRE onReport path LIVE)
- Settlement gate: ON (settle requires canSettle(goalId))

## Gate proof against the new registry 2026-07-27
- Gated HealthPools (proof instance): 0x474F61Fffd27e17F3c702982c84291567368925d -> 0x9bf5...F042
- Proof: scripts/tier1-gate-proof.sh (now reads HEALTH_VERDICT_ADDRESS from .env, not a hardcoded address)
- Two participants, IDENTICAL passing oracle results; only the one with a HealthVerdict was paid:
  A (verdict) 6993004 -> 8993004 = +2.00 USDC | B (no verdict) 478608 -> 478608 = +0
- Settle tx: 0xfdaff54d7a38d0c38a2ac94048086ef95b4475566dc7e9084b48d20bc34d28f6
- Confirms the new goalId schema and the gate are load-bearing on chain: no verdict -> no payout.

## Demo reset 2026-07-31T06:36:20Z
- HealthPools: 0xc4274eF2cBe28f77Af31b980055Cc1171818390C
- Explorer: https://testnet.arcscan.app/address/0xc4274eF2cBe28f77Af31b980055Cc1171818390C
- Seeded: sleep (Dreamwell), recovery (Vitality), steps (Iron Gym),
          flu-shot [doc], screening [doc] (preventive-care, document-verified)
- HealthVerdict: 0x9bf5e4b54361DEAca4314c1d8de3aeB30111F042 (attester 0xA56eAD3A32b6261bDE6C2A45495C9250084F7F2D)
- Forwarder: 0x76c9cf548b4179F8901cda1f8623568b58215E62 (Arc KeystoneForwarder — CRE onReport path LIVE)
- Settlement gate: ON (settle requires canSettle(goalId))
