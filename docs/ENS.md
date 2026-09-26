# ENSv2 in GoHealthMe V4

GoHealthMe pools, participants and the settlement agent (SPOTTER) get real ENSv2 names on Ethereum Sepolia. Pools and USDC stay on Base Sepolia; names are read and written on Ethereum Sepolia and shown next to the Base state. Every name the app shows is resolved through the ENSv2 Universal Resolver with viem. There is no lookup table and no hard-coded name.

## Why it improves the product

| Before (V3 pilot) | After (V4) | ENSv2 feature doing the work |
|---|---|---|
| "You got paid" is a Basescan link in the claim rail. | The settlement receipt (Base tx, time, signer, achiever count) lives at `pool-<id>.gohealthme.eth`. Anyone can check it with any ENS client. | Permissioned Resolver |
| SPOTTER is a hex string on `/agent`, and its authority is something you trust. | `spotter.gohealthme.eth` resolves to both agent wallets (Sepolia signer, Base settler). It can write the four receipt keys and nothing else, and anyone can verify that on chain. | Enhanced Access Control (per-key setter roles), own namespace for the agent |
| A participant is a handle in Supabase. | A participant is `<name>.gohealthme.eth`, a token in their own wallet with `addr(60)` pointing back at it. Supabase is only a cache. | Registry hierarchy (GoHealthMe runs its own UserRegistry under `gohealthme.eth`) |

Records carry money facts and tx hashes only. There is no health data key, and `lib/ens/names.ts` defines none.

## The name tree

```
eth (ETHRegistry, ENS)
 gohealthme.eth             owner key; subregistry = GoHealthMe's UserRegistry proxy,
   |                        resolver = GoHealthMe's PermissionedResolver proxy
   spotter.gohealthme.eth   owned BY the agent, role bitmap 0 (cannot re-point, transfer or mint)
                            addr(60) = agent Sepolia signer, addr(84532) = Base settler (read live from HealthPoolsV3)
   pool-<id>.gohealthme.eth created lazily at first settle; addr(84532) = HealthPoolsV3,
                            text gohealthme.pool.id, gohealthme.pool.contract,
                            receipt: gohealthme.settle.tx / .at / .by / .achievers
   <name>.gohealthme.eth    minted to a participant's wallet at character creation, addr(60) = wallet,
                            same roles an .eth registrant gets (set resolver, set subregistry, transfer)
```

The registry and resolver proxy addresses are never configured: `lib/server/ens/client.ts` reads them from `ETHRegistry.getSubregistry("gohealthme")` and `getResolver("gohealthme")`, the same way any third party finds them.

## The permission boundary

On the Permissioned Resolver the owner key calls `grantSetterRoles(setText(<parent>, key, ""), agent)` for each of the four receipt keys. Enhanced Access Control scopes `ROLE_SET_TEXT` to the resource `keccak256(key)`, so the agent key:

- CAN `setText` `gohealthme.settle.tx|at|by|achievers`
- CANNOT `setText gohealthme.pool.id` (rewrite what a pool is)
- CANNOT `setAddress` (re-point its own name or any other)
- CANNOT `linkToNode` (alias records; root-only `ROLE_LINK`)
- CANNOT `register` or `setResolver` on GoHealthMe's registry (no registry roles)

A stranger cannot write the receipt key either. `scripts/ens-boundary-proof.sh` proves every row with `eth_call` against live Sepolia and exits non-zero if the boundary does not hold. It needs no key. `/agent` can render the same rows from `permissionMatrix()` in `lib/server/ens/resolve.ts` (the UX lane mounts it).

Honest limits, stated here so nobody finds them later: the receipt keys are scoped per resolver, not per name, so the agent could write a `gohealthme.settle.*` key on a participant's name too (it cannot touch any other key). The owner key holds root roles and can change any record under the namespace; a participant who wants out can re-point their name's resolver, because their token carries that role.

## Where it runs in the product

- **Character creation, step 3:** `components/ens/EnsNameClaim.tsx` checks availability live (`GET /api/ens/available`), asks the wallet for the same ownership signature the handle claim uses (no transaction, no gas for the user), calls `POST /api/ens/claim`, shows the Sepolia tx, and calls `onClaimed` only once `GET /api/ens/resolve` returns the name for the wallet. Invalid or reserved names are refused at the input, before any signature.
- **Names need a human:** a gohealthme.eth name costs GoHealthMe Sepolia gas, so while World prove-human is on (`WORLD_VERIFY_MODE` live or mock) `POST /api/ens/claim`, the handle-claim mint and `POST /api/ens/link` require the signing wallet to be a World-verified human (`lib/server/ens/human-gate.ts`, reading the same record as `requireHuman`). A refusal is a plain 403, "Prove you are one human first, then pick your name.", and nothing is minted. One human, one name: the first wallet that claims for a nullifier holds it (`ens-human-name-<namespace>-<nullifier>.json`); another wallet of the same human is refused. With World off the claim behaves as before. Character creation shows step 3 locked with that same line and a way to step 2, never a button that fails after the tap.
- **Use a name I already own:** step 3 also takes an existing ENS name. `POST /api/ens/link` (signature-gated like the claim) forward-resolves it with viem on Ethereum mainnet (viem's own universal resolver) and on Sepolia (the ENSv2 universal resolver in `deployments.ts`) and accepts it only when an address record equals the wallet. The link is stored as `ens-link-<address>.json` in the shared store; nothing is minted. `DELETE /api/ens/link` forgets it, and claiming a subname drops it so the new name shows.
- **Existing handle claim:** `lib/server/social-profile.ts` claimHandle (fenced `// --- ens ---` block) also mints `<handle>.gohealthme.eth` when the handle is a valid ENS label. Handles with underscores keep working; they just get no subname (logged).
- **Showing names:** `components/ens/EnsName.tsx` renders the short address immediately and flips to the name. `GET /api/ens/resolve` takes one address or a comma list (max 50), tries a linked own name first (re-verified on both chains when the last check is over an hour old, and dropped once it no longer resolves to the wallet), then the wallet's ENS primary name, then GoHealthMe subnames indexed from `LabelRegistered` events, keeping one only if its `addr(60)` resolves back to the wallet. Cached server side (5 min hit, 45 s miss), invalidated by the claim.
- **Settlement receipt:** after `run.ts` asserts the AchieverPaid payout and appends the settled ledger row, one fenced block calls `writeSettlementReceipt` (`lib/server/ens/receipt.ts`). It sends the multicall and returns; it never throws, never blocks the payout. The sweep does the same for pools it settles itself, then reconciles: any settled pool whose receipt does not resolve is written again with inclusion asserted on `TextUpdated` logs. A settled pool with no known settle tx is logged and never given an invented receipt.
- **Reading it back:** `GET /api/ens/receipt?poolId=` returns what the Universal Resolver returns, with `status` `written`, `pending` (with the Sepolia tx) or `none`.

## Setup

1. `cd app && npm run ens:bootstrap -- --plan` prints what is left (reads only).
2. `npm run ens:bootstrap` deploys the two proxies, registers `gohealthme.eth` (commit, 60 s wait, register, paid in the deployment's MockUSDC which has a public mint), registers `spotter`, sets its address records, grants the four receipt keys, and sends the agent 0.003 Sepolia ETH for receipt gas. Idempotent and resumable; state in `app/.data/ens-bootstrap-state.json`. Every tx is appended to `DEPLOYMENTS.md` under "Tokyo 2026 (ENSv2 Sepolia)". It stops before any step that would take the owner below 0.005 ETH and prints the exact shortfall.
3. `./scripts/ens-boundary-proof.sh` proves the boundary.
4. Put the env vars below in the Vercel project `gohealthme-tokyo`.

Measured cost at about 1.1 gwei: well under 0.01 ETH for the whole bootstrap including the agent top-up. The deployer held 0.031 Sepolia ETH on 2026-09-26, which is enough.

## Env vars (server only, never `NEXT_PUBLIC_`)

| Var | What | Where from |
|---|---|---|
| `ENS_OWNER_PRIVATE_KEY` | Owns `gohealthme.eth`; mints participant and pool names, pays their gas. Missing: claims return a plain 503 "not configured", receipts still work. | The deployer key `0xc278...04e1` (the bootstrap falls back to `PRIVATE_KEY` from `contracts/.env`). |
| `ENS_AGENT_PRIVATE_KEY` | SPOTTER's Sepolia signer, writes receipts. Falls back to `TREASURY_PRIVATE_KEY`. Missing: receipts are skipped with a logged reason, payouts unaffected. | Generated by the bootstrap into `app/.env.local` if absent. |
| `ENS_PARENT_NAME` | Default `gohealthme.eth`. | Optional. |
| `ENS_SEPOLIA_RPC_URL` | Default `https://ethereum-sepolia-rpc.publicnode.com`. | Optional; a keyed RPC is better for the sweep. |
| `MAINNET_RPC_URL` | Ethereum mainnet RPC for checking linked own names. Default: viem's public mainnet transport. | Optional; a keyed RPC is steadier. |
| `ENS_INDEX_FROM_BLOCK` | First block the name index scans; default is 200k blocks back. | Set to the bootstrap block. |

## How judges verify

- Open `https://sepolia.app.ens.domains/spotter.gohealthme.eth` and `.../pool-<id>.gohealthme.eth`: the address and text records are there.
- Or in a terminal: `viem` `getEnsText({ name: "pool-<id>.gohealthme.eth", key: "gohealthme.settle.tx", universalResolverAddress: "0x5d25c1d6acbb71b7a28aa7899618a3412a8303e3" })` on Sepolia, then open that tx on sepolia.basescan.org.
- Run `./scripts/ens-boundary-proof.sh` for the allowed/denied table.

## Contracts used

The 2026-09-15 ENSv2 Sepolia deployment, verified 2026-09-26 against docs.ens.domains/learn/deployments and with `cast code`. Table in `app/lib/server/ens/deployments.ts` and `DEPLOYMENTS.md`. ABI snippets come from namechain tag `sepolia-deployment-2026-09-15`. `@ensdomains/ensjs` from npm is deliberately not used: its published version predates this deployment and encodes an `initialize` the live implementations no longer have.

## What Andre or Nikki must do

1. Put the real deployer key in `gohealthme-tokyo/contracts/.env` as `PRIVATE_KEY` (the file currently holds a placeholder) or set `ENS_OWNER_PRIVATE_KEY`, then run `npm run ens:bootstrap` from `app/`. No faucet needed at current gas.
2. Copy `ENS_OWNER_PRIVATE_KEY` and `ENS_AGENT_PRIVATE_KEY` into the Vercel project env.
3. Booth question: is the 2026-09-15 deployment the one judges check, and is a redeploy planned before Sunday. A redeploy would mean re-running the bootstrap against the new addresses in `deployments.ts`.
