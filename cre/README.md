# GoHealthMe — Chainlink CRE workflow (Confidential AI Attester)

`wf-goal-verification` is a single Chainlink CRE workflow that verifies whether a
GoHealthMe participant met a health goal, **confidentially** (the analysis runs
inside a TEE), and writes a DON-signed verdict on chain.

It follows Chainlink's **official Confidential AI Attester callback architecture**,
reimplemented for the health-goal domain. Reference (MIT, (c) Chainlink Labs),
studied and adapted with attribution (see `../AI_ATTRIBUTION.md`):

> Chainlink Confidential AI Attester — Undercollateralized Loan Demo
> https://github.com/smartcontractkit/chainlink-confidential-ai-attester-demo

No reference source files were copied verbatim. Our contracts, workflow, report
encoding, and synthetic (no-PHI) documents are GoHealthMe's own.

## Architecture (callback model)

This is NOT an outbound `ConfidentialHTTPClient` call. The app POSTs a health
document to the Attester with a `cre_callback` URL; the Attester runs inference in
its TEE and POSTs the verdict back to that URL — which IS this workflow's
HTTP-trigger endpoint.

```
  GoHealthMe app / cre/scripts/call-attester.mjs
      |  POST /v1/inference  (synthetic health summary + cre_callback = CRE trigger URL)
      v
  Chainlink Confidential AI Attester   (LLM inside a TEE)
      |  decides verified/declined, signs request+response digests,
      |  POSTs the verdict to cre_callback
      v
  CRE workflow  (wf-goal-verification/main.ts)
      1. HTTP trigger receives the callback body (payload.input bytes)
      2. status !== "completed"  -> log + return early
      3. parse the verdict JSON from `output` (strip the ```json fence)
            -> { verified, confidence, reason, metric_value, threshold }
      4. digest = resources[0].response_digest        (TEE transcript hash)
      5. goalId = keccak256(abi.encode(poolId, user)) [matches HealthVerdict.computeGoalId]
      6. encodeAbiParameters(bytes32 goalId, bool verified, uint8 confidence,
                             bytes32 digest, uint16 bitmap)
      7. runtime.report(...)  ->  EVMClient.writeReport(...)
      |  signed report, delivered via the KeystoneForwarder
      v
  contracts/src/HealthVerdict.sol :: onReport(bytes metadata, bytes report)  [onlyForwarder]
      • abi.decode(report) -> (goalId, verified, confidence, digest, bitmap)
      • records the verdict (same storage as recordVerdict)
      v
  HealthPools.settle() consults HealthVerdict.canSettle(goalId)
```

### The on-chain interface (exact match with the workflow)

`HealthVerdict.onReport` is the Chainlink CRE / KeystoneForwarder receiver:

```solidity
function onReport(bytes calldata metadata, bytes calldata report) external onlyForwarder {
    (bytes32 goalId, bool verified, uint8 confidence, bytes32 digest, uint16 bitmap) =
        abi.decode(report, (bytes32, bool, uint8, bytes32, uint16));
    // ... one-shot record into the same storage as recordVerdict ...
}
```

The workflow encodes the report body with the identical tuple order/types:

```ts
const REPORT_ABI = [
  { name: 'goalId',     type: 'bytes32' },
  { name: 'verified',   type: 'bool'    },
  { name: 'confidence', type: 'uint8'   },
  { name: 'digest',     type: 'bytes32' },
  { name: 'bitmap',     type: 'uint16'  },
] as const
const encodedReport = encodeAbiParameters(REPORT_ABI, [goalId, verified, confU8, digest, bitmap])
```

This off-chain → on-chain contract is pinned by the Foundry test
`test_onReport_decodesWorkflowEncodedReport`, which feeds the *exact* hex the
workflow's dry-run produces back through `onReport` and asserts the decoded
verdict. `computeGoalId` matches `HealthVerdict.computeGoalId`
(`keccak256(abi.encode(poolId, participant))`).

### Two ingestion paths (both into the same storage)

1. `recordVerdict(...)` — the **attester-EOA path** (a relayer that holds the
   `attester` role). Kept for backward compatibility and non-CRE flows.
2. `onReport(metadata, report)` — the **Chainlink CRE / KeystoneForwarder path**
   (`onlyForwarder`). The forwarder defaults to `address(0)` (disabled) until the
   owner calls `setForwarder(...)` with the real Forwarder on the target chain (or
   a mock forwarder in tests).

## Privacy design

1. **The raw health doc is analysed inside the Attester's TEE.** The DON never
   sees raw wearable samples; the app sends the doc to the Attester, not to the
   workflow.
2. **The workflow only ever sees the structured verdict + signed digests** in the
   callback body.
3. **Nothing sensitive lands on chain.** `HealthVerdict` stores only
   `{ verified, confidence, keccak(transcript digest), facet bitmap, attester, timestamp }`.

## Project layout

```
cre/
  project.yaml                          # CRE project settings (targets, rpcs)
  package.json / tsconfig.json          # TS toolchain (typecheck + dry-run + call-attester)
  wf-goal-verification/
    workflow.yaml                       # workflow settings (no secrets-path: callback model)
    main.ts                             # the workflow (Attester callback -> onReport via forwarder)
    config.json                         # poolId, user, receiver, chain selector, authorizedKeys
    package.json                        # workflow deps for the cre/bun compile step
  scripts/call-attester.mjs             # app-side: POST a health doc to the Attester w/ cre_callback
  simulation/
    callback-payload.json               # recorded Attester callback (offline simulation input)
    health-summary.txt                  # synthetic, no-PHI weekly health summary
    inference-prompt.txt                # the exact /v1/inference prompt
  src/dry-run.ts                        # deterministic offline harness (no CRE host needed)
  sim-output/                           # captured outputs + BLOCKER.md
```

## How to simulate

### Prerequisites

```bash
~/.cre/bin/cre version     # v1.20.0 here
~/.bun/bin/bun --version   # 1.3.x here
cd cre && bun install
```

### Scenario 1 — offline simulation (recorded callback)

Run from `cre/`, with env loaded from the repo `.env`:

```bash
set -a; source ../.env; set +a
cre workflow simulate ./wf-goal-verification \
  --non-interactive --trigger-index 0 \
  --http-payload ./simulation/callback-payload.json \
  --broadcast
```

> **Known blocker on this machine:** CRE CLI **v1.20.0** requires a Chainlink
> login *before* it will simulate (even offline with `--http-payload`). The
> official demo was verified on v1.19.0 where local simulation needed no login.
> Exact message and full diagnosis: `sim-output/BLOCKER.md` and
> `sim-output/cre-simulate-broadcast.log`. To unblock: run `cre login` once
> (browser flow) **or** set `CRE_API_KEY` in `../.env`, then re-run; **or**
> downgrade the CLI to v1.19.0.

### Scenario 2 — live end-to-end (Attester -> local trigger)

Needs ngrok (or cloudflared) to expose the local trigger to the remote Attester.

```bash
# terminal 1 — start the workflow's local HTTP-trigger server (no --http-payload)
set -a; source ../.env; set +a
cre workflow simulate ./wf-goal-verification --broadcast
#   -> "listening on http://localhost:2000/trigger"

# terminal 2 — expose port 2000
ngrok http 2000            # -> https://<id>.ngrok-free.dev

# terminal 3 — POST a synthetic health doc to the Attester with that callback URL
set -a; source ../.env; set +a
node scripts/call-attester.mjs "https://<id>.ngrok-free.dev/trigger"
```

The Attester runs inference in its TEE and POSTs the verdict to the ngrok tunnel
-> the local trigger -> the workflow encodes it and (with `--broadcast` + a real
receiver) writes through `HealthVerdict.onReport`.

### Deterministic dry-run (no CRE host, no auth, no network)

```bash
cd cre
bun run dry-run            # uses simulation/callback-payload.json
#   captured: sim-output/dry-run.json
```

This reproduces the workflow's deterministic core (parse callback, derive verdict
+ digest, compute goalId, ABI-encode the `onReport` report body) with viem only.

## What works now vs. what needs the booth

### Verified locally

- Workflow typechecks clean against `@chainlink/cre-sdk@1.11.0`.
- Dry-run produces the correct goalId, verdict, digest, bitmap, and the exact
  `onReport` report body.
- The encoded report body decodes correctly on chain — pinned by
  `test_onReport_decodesWorkflowEncodedReport` (Foundry). Full contract suite: 62
  tests passing (51 pre-existing + 11 new for the forwarder / onReport path).

### Blocked / needs credentials

- **`cre workflow simulate` requires authentication on CLI v1.20.0.** See
  `sim-output/BLOCKER.md`.

### Live DON write — booth dependencies RESOLVED (2026-07-27)

Both values the hackathon notes deferred to "ask at the booth" are now public in
Chainlink's docs, and the forwarder is confirmed deployed on Arc testnet.

| what | value | source |
|---|---|---|
| Arc testnet KeystoneForwarder | `0x76c9cf548b4179F8901cda1f8623568b58215E62` | [CRE forwarder directory](https://docs.chain.link/cre/guides/workflow/using-evm-client/forwarder-directory-ts) — verified: 17KB of code live on Arc |
| Arc testnet chain selector | `3034092155422581607` | [CCIP directory: arc-testnet](https://docs.chain.link/ccip/directory/testnet/chain/arc-testnet) |
| CRE chain-name | `arc-testnet` | forwarder directory |

**Bug this surfaced:** `config.json` previously set `chainSelector: "5042002"`,
which is Arc's **chain id**, not its Chainlink **chain selector**. They are
different namespaces. `new cre.capabilities.EVMClient(BigInt(chainSelector))`
would not have resolved a chain, so any live `writeReport` would have failed.
Fixed to `3034092155422581607`.

`config.healthVerdictAddress` now points at the deployed registry
`0x4E65F11b65b53A328713B40C02A1BC1F421E1c51`, so `receiverUnset` is false and the
workflow will attempt the real `writeReport` instead of returning encoded-only.

### Remaining to actually go live

1. **`HealthVerdict.setForwarder(0x76c9cf548b4179F8901cda1f8623568b58215E62)`** —
   on-chain owner tx from the deployer `0xc278…04e1`. Until this lands,
   `forwarder == address(0)` and every `onReport` call reverts `NOT_FORWARDER`.
   Note `setForwarder` requires a non-zero address, so the CRE path cannot be
   turned back **off** once enabled — only re-pointed at another address.
2. **`authorizedKeys` must be non-empty to deploy.** An empty list is valid
   *only* for `cre workflow simulate`; the CRE gateway rejects a **deployed**
   HTTP trigger that has no authorized keys. Populate it with the EVM address
   whose key signs the Confidential AI Attester's `cre_callback` POST, as
   `{ "type": "KEY_TYPE_ECDSA_EVM", "publicKey": "<0x… EVM address>" }`. This is
   the one value still outstanding — it comes from the Attester service, not from
   the forwarder directory.
3. **Gate a HealthPools that can actually consult the registry.** The canonical
   prod instance `0x72D3…2064` predates the gate selectors — `healthVerdict()`
   reverts on it — so it can never be wired. Only the side instance
   `0x5bf7…2cF4` is gated. Closing this needs a prod redeploy + migration of the
   15 pools currently live on `0x72D3…2064`.

### Verified against the live deployment (2026-07-27)

- Dry-run `goalId` `0x7611f4f4…648b720a` **equals** live
  `HealthVerdict.computeGoalId(1, 0x8ba1…BA72)` on Arc — the off-chain pipeline
  and the deployed contract agree.
- The workflow's encoded report body decodes to exactly
  `(goalId, true, 2, 0x0a012491…95c6ecea, 5)` under `onReport`'s tuple.
- Contract suite: 62/62 Foundry tests passing (forge 1.7.1).

## Config reference (`wf-goal-verification/config.json`)

| key | meaning |
|---|---|
| `poolId` | pool the goal belongs to; part of the deterministic goalId |
| `user` | participant address; part of the deterministic goalId |
| `healthVerdictAddress` | receiver; zero address = report-only (not yet deployed) |
| `chainSelector` | receiver chain selector (Arc) |
| `writeGasLimit` | gas limit for the `writeReport` forward |
| `authorizedKeys` | EVM addresses (`KEY_TYPE_ECDSA_EVM`) allowed to sign incoming HTTP trigger requests. Empty is valid **only** for `cre workflow simulate`; a deployed workflow with an empty list is rejected by the CRE gateway. Must be populated before deploy — see "Remaining to actually go live". |
