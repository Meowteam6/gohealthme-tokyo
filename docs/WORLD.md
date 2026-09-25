# World ID in GoHealthMe V4 (ETHGlobal Tokyo 2026)

Hackathon build. Two World tracks, two lanes, one document:

- **IDKit, "prove you're one human"** (this section, lane `world-idkit`): character creation step 2. A wallet must prove it belongs to one human before it can stake, and one human can hold one wallet. Verified server-side; the product refuses to verify or pay an unproven wallet.
- **World ID for Agents** (lane `world-agents`, section at the end): SPOTTER asks the achiever for a fresh verification before the protected action (settle or payout) and refuses on denial or expiry.

World ID existed in V1 (ETHGlobal NY, IDKit 4.1.8, per-pool actions, removed in V2). V4 reimplements it on **@worldcoin/idkit 4.3.0** with the World ID 4.0 RP-signed request flow, read from `docs.world.org/world-id/idkit/integrate` and the package's own type definitions on 2026-09-26. Nothing from V1 was resurrected.

**Proofs are mocked at this event.** The prize page says so, and the event has no sandbox app. `WORLD_VERIFY_MODE=mock` is the deployment we demo on; it accepts an IDKit-shaped payload, checks its wallet binding, and derives a deterministic nullifier without calling World. Every screen that shows a mocked result says "event mode, mocked proofs". It is not a proof of personhood and must never run on a deployment with real users. `WORLD_VERIFY_MODE=live` is the real integration against World's cloud verify API and is what the code is written for.

## Setup (Andre, about ten minutes)

> One set of credentials drives both prove-human and the payout confirmation: `WORLD_APP_ID`, `WORLD_RP_ID`, `WORLD_RP_SIGNING_KEY`. Use a **Production** app on the live build (the code refuses staging there) and a **Staging** app on preview deployments, where the World simulator works.

1. Go to https://developer.world.org and sign in. Click **Create app**. Name it `GoHealthMe`, pick **Staging** for the environment you will test with (the simulator only works against staging). Save.
2. On the app page, copy the **App ID** (`app_...`) and the **RP ID** (`rp_...`). If the page offers a **World ID 4.0 migration** toggle, turn it on; the v4 verify endpoint answers `app_not_migrated` otherwise.
3. Under **Signing key** (RP keys), generate a key and copy the **hex private key**. It is shown once. This is `WORLD_RP_SIGNING_KEY` and it never leaves the server.
4. Under **Incognito actions**, click **New action**. Action identifier `prove-human`, description "Prove you're one human to play a GoHealthMe pool". Set **Max verifications per user** to **Unlimited** (see "Why unlimited" below). Save.
5. Paste into `app/.env.local` (never committed) and into the Vercel project `gohealthme-tokyo` (Preview and Production):

```
WORLD_VERIFY_MODE=live
WORLD_APP_ID=app_...
WORLD_RP_ID=rp_...
WORLD_RP_SIGNING_KEY=<hex from step 3>
WORLD_ACTION=prove-human
WORLD_ENVIRONMENT=staging
```

6. Test with the simulator: open https://simulator.worldcoin.org, create or pick an identity, then on the app tap **Verify with World ID** and scan the QR with the simulator. Scan the same identity from a second wallet to see the denied path.
7. For the on-stage demo set `WORLD_VERIFY_MODE=mock` instead (the other five variables are then ignored). Switching modes is a Vercel env change, no code change.

**Why unlimited.** An incognito action with max verifications 1 makes World itself refuse the second proof of the same human (`max_verifications_reached`), before GoHealthMe's own binding can run. That is a valid denied path, but the app's 409 is the better one: it names the wallet the person verified with and tells them to sign in with it. With Unlimited, World checks the proof and GoHealthMe enforces one human, one wallet. Either way a second entry never happens; with 1, the screen reads "This World ID has already been used for this action" instead.

## Credentials (no Orb gate)

Founder decision, 2026-09-26: anyone with World App can play. Prove-human and the payout confirmation share one policy (`app/lib/world/credentials.ts`):

- **World ID 4.0 first:** any one of Orb (`proof_of_human`), NFC passport, My Number Card, or Selfie Check. Selfie Check needs only World App and a camera, so every 4.0 holder can pass.
- **3.0 fallback:** only when World App answers `world_id_4_not_available`, the check reopens at Device level, which accepts the user's highest 3.0 credential. It stays bound to the same signal.
- The credential that verified is stored on the human record and the approval ledger row, and the feed shows it.

**The tradeoff, stated plainly.** Only an Orb credential proves an Orb-verified unique human. Selfie Check, documents and device-level proofs are weaker sybil resistance: a determined person could hold more than one. GoHealthMe still enforces one World ID per wallet and one wallet per World ID through the nullifier. This was a deliberate accessibility choice for the beta; stakes are test USDC.

## Environment variables

| Variable | Where | Meaning |
|---|---|---|
| `WORLD_VERIFY_MODE` | server | `live`, `mock` (event mode), or unset (prove-human off). Anything else resolves to off with a visible problem string. |
| `WORLD_APP_ID` | server | Developer Portal App ID, `app_...`. Live only. |
| `WORLD_RP_ID` | server | Developer Portal RP ID, `rp_...`. Live only. Used in the verify URL. |
| `WORLD_RP_SIGNING_KEY` | server | RP signing key, hex. Live only. Signs every request (`signRequest` from `@worldcoin/idkit-core/signing`). |
| `WORLD_ACTION` | server | Incognito action identifier. Default `prove-human`. One action for the whole app: one nullifier per human is what "one human, one wallet" needs. |
| `WORLD_ENVIRONMENT` | server | `staging` (default, simulator) or `production`. The server refuses a proof whose environment differs. |

No `NEXT_PUBLIC_` variable exists: the browser learns the mode, app id, action and environment from `GET /api/world/rp-context`. A `live` with a missing variable fails closed to off and the card says which variable is missing.

## The flow

Files: `app/lib/server/world/` (server), `app/app/api/world/` (routes), `app/lib/world/` (browser helpers), `app/components/world/ProveHuman.tsx` and `IdkitWidgetHost.tsx` (UI), `app/lib/server/access.ts` (approval by World), fenced `// --- world-idkit ---` blocks in `app/app/api/agent/run/[goalId]/route.ts`, `app/app/api/evidence/submit/route.ts` and `app/lib/server/rate-limit.ts`.

Live mode:

1. `ProveHuman` mounts (the UX lane mounts it as character creation step 2). It calls `GET /api/world/rp-context` and renders for the deployment's mode.
2. On tap, `POST /api/world/rp-context` mints a signed RP context on the server (`rp_id`, `nonce`, `created_at`, `expires_at`, `signature`, 300 s window). The signing key is never sent to the browser.
3. `IdkitWidgetHost` opens `IDKitRequestWidget` with `app_id`, `action`, `rp_context`, `environment`, `allow_legacy_proofs: true`, and `preset: proofOfHuman({ signal: <wallet address, lowercased> })`. The person scans with World App (or the staging simulator).
4. The widget hands `handleVerify` the IDKit result payload. The card posts it to `POST /api/world/verify` as `{ address, proof }` with the app's EIP-191 wallet-signature headers (`lib/server/wallet-auth.ts`), so the caller must hold the wallet the proof is bound to.
5. The server (`lib/server/world/verify.ts`): checks the proof's `action` equals `WORLD_ACTION`; checks `responses[0].signal_hash` equals `hashSignal(address.toLowerCase())` (a proof made for another wallet, or with no signal, is refused); checks the environment; then forwards the payload as-is to `POST https://developer.world.org/api/v4/verify/{rp_id}`. World's error codes become plain sentences. The returned nullifier is canonicalised (`lib/server/world/nullifier.ts`).
6. `bindHuman` (`lib/server/world/human.ts`) runs under the store lock: the wallet may hold one nullifier and the nullifier may hold one wallet. The reverse index is written before the wallet record so a crash cannot leave one human on two wallets. Storage is the app's KV/file store (`lib/server/store.ts`): Upstash on Vercel, JSON files locally.
7. `200 { ok, nullifierHash, verifiedAt, mode }`. Only then does the card call `onVerified`. `GET /api/world/status?address=` now answers `verified`, `useHumanStatus` flips, and `lib/server/access.ts` counts the wallet as approved with `source: "world"`.

Mock mode (event): steps 2 and 3 are replaced by a text field. The card builds an IDKit-shaped v4 payload (`lib/world/mock-proof.ts`): `environment: "mock"`, `signal_hash` for the wallet, and a nullifier derived from the typed identity. Step 5 becomes `verifyMock`: same action and signal checks, World is not called, and the stored nullifier is `keccak256("gohealthme-mock-proof:<action>:<payload nullifier>")`, so the same identity always maps to the same human. Steps 4, 6 and 7 are identical. The record carries `mode: "mock"` and the card says so.

Mode unset: `GET /api/world/rp-context` answers `{ mode: "off" }`, the card says "Prove-human is not enabled on this deployment", `requireHuman` is a no-op, and `access.ts` keeps the closed-beta allowlist. Nobody hits a new dead end.

## Server-side teeth

`joinPool` is an on-chain call the browser makes directly, so the server cannot refuse a stake at the contract. What it refuses is everything that turns a stake into money. `requireHuman(address)` (`lib/server/world/require-human.ts`) is called, fenced, in:

- `POST /api/agent/run/[goalId]` after the membership check and before the plan entry: SPOTTER neither verifies nor pays an unproven wallet, and spends nothing on it.
- `POST /api/evidence/submit` after the membership check: no TEE inference is bought for an unproven wallet.

Both answer `403` with "Prove you're one human before playing this pool..." when `WORLD_VERIFY_MODE` is set and the wallet has no binding. When it is unset they are no-ops. The join surfaces (pool page and `/c/[token]`, UX lane, through `lib/wearable-join-gate.ts` and `useHumanStatus`) withhold the stake button until the wallet is verified, so an honest user never reaches these refusals; only a caller who staked by hand does, and the reason tells them how to fix it.

## The denied path (the alternative paths the prize asks for)

1. **Same human, second wallet.** Wallet B completes the World check with the identity that already verified wallet A. World accepts the proof (it is valid), `bindHuman` refuses it, the route answers `409 { conflict: "human-has-other-wallet", otherWallet: <A> }`, and the card shows "SPOTTER already knows you." with "Sign out, then sign in with 0x8ba1...BA72 to keep playing as the human you already proved. Nothing was staked from this wallet." `onFailed` fires with that reason; the card stays retryable. No approve, no `joinPool`, no ledger entry; wallet B stays unverified and `requireHuman` keeps refusing it.
2. **Second human, bound wallet.** `409 { conflict: "wallet-has-other-human" }`, "This wallet is taken."
3. **Cancelled.** The person closes the widget (`user_rejected`, `cancelled`, `verification_rejected`): "You closed the check. Nothing happened and nothing was staked." with a retry.
4. **Proof for another wallet, expired request, World rejection, World unreachable.** 401 or 502 with the plain reason; the card renders it and offers a retry where one makes sense (`lib/world/idkit-errors.ts`).
5. **Bypass.** A wallet that staked by hand without verifying: its claim run and evidence submit answer 403; the stake follows the pool's normal non-achiever rules.

## Which users are worse off

Checked against both staking surfaces:

- **A person with no World App and no access to the event identities**, on a deployment with the mode on: they cannot stake. They see it at character creation, before any USDC moves, in plain words, and in mock mode they can type any identity. On a `live` deployment this is the real cost of one human, one entry; whether the pilot keeps a hard gate is Nikki's call and is logged in the ledger.
- **The same human on a second wallet**: refused by design, told which wallet to use, nothing staked.
- **V3 pilot participants and every deployment without the mode**: unchanged. `WORLD_VERIFY_MODE` unset is byte-for-byte the V3 gate. V4 is a separate Vercel project with its own KV, so nothing here touches the pilot.
- **A wallet that staked by hand before verifying**: its stake is in the pool and SPOTTER will not pay it until it verifies from the character card, which the 403 reason says.
- **Operator misconfiguration** (`live` with a variable missing): the card says which variable, the mode falls back to off, the allowlist still works.

## What is mocked, and what is not

Mocked in event mode only: the World App scan and World's verify call. Not mocked in any mode: the wallet-signature check, the action check, the signal binding to the wallet, the one-human-one-wallet binding, the 409s, the server-side refusals in the run and evidence routes, and the access approval. The mock nullifier derivation is in `verifyMock`; the payload shape it accepts is the same IDKit v4 shape the live path forwards to World, parsed by the same code.

## Integration debrief (for the IDKit submission)

What worked: `@worldcoin/idkit` 4.3.0's `IDKitRequestWidget` maps cleanly onto a Next.js App Router app once the SDK is confined to one client-only component (the core resolves its WASM with `new URL(..., import.meta.url)`, so it is loaded through `next/dynamic` with `ssr: false`). `signRequest` and `hashSignal` from `@worldcoin/idkit-core` are pure JS and run on the Node route runtime, which made the server-signed RP context and the signal binding straightforward. Forwarding the IDKit payload as-is to `POST /api/v4/verify/{rp_id}` meant no field remapping, and accepting both `3.0` and `4.0` shapes was one parser.

What we changed from V1: V1 used a per-pool action (`join-pool-<id>`) and stored the pair per pool, so one human could hold as many wallets as there were pools. V4 uses one action and binds the nullifier to the wallet, which is the property the product needs (a sponsor bounty cannot be farmed by minting email wallets). V1 also treated the verification record as non-fatal; V4 makes the binding the thing the money routes check.

What was awkward: the docs describe `rp_context` and `signRequest` but not what happens when the RP signature window (300 s) lapses between page load and tap, so the card mints the context on tap, not on mount. The `environment` value `"sandbox"` exists in the SDK types and not in the integrate doc. The event mocks proofs, so the live path was exercised against a stubbed World API in tests and could not be driven end to end without a Portal app; the mock mode is deliberately the same parser and binding code with only the World call removed, so the two paths cannot drift. What we would change: a Portal-side flag that makes the staging simulator return a fixed identity for a given action would let the denied path be tested in CI without a phone.

## Tests

`cd app && npm test` runs them with the rest of the suite. World-specific files:

- `lib/server/world/config.test.ts`: the three modes, missing-variable fallback, unknown value.
- `lib/server/world/verify.test.ts`: payload parsing, nullifier canonicalisation, live success and every refusal (action, signal, missing signal, environment, World rejection, World unreachable), mock determinism and binding.
- `lib/server/world/human.test.ts`: first bind, idempotent re-bind, both 409s with the wallet handed back, crash self-heal, concurrent binds.
- `lib/server/world/require-human.test.ts`: off is a no-op, on refuses the unproven and passes the proven.
- `app/api/world/verify/route.test.ts`: the route end to end with real wallet signatures, mock success, both 409s, wrong-wallet proof, unsigned, malformed, mode off, live against a stubbed World API.
- `app/api/world/rp-context/route.test.ts`: per-mode answers, GET never mints, POST mints a real signature.
- `lib/server/access.test.ts`: approval by World on, ignored when off, admin switch kept, denial record untouched.
- `app/api/agent/run/[goalId]/route.test.ts` and `app/api/evidence/submit/route.test.ts`: the 403 before any spend, and the pass-through for a proven human.
- `lib/world/api.test.ts`, `lib/world/mock-proof.test.ts`, `lib/world/idkit-errors.test.ts`: the browser helpers.

## World ID for Agents (lane `world-agents`)

Written by the `world-agents` lane: the approval request, the fresh verification before settle or payout, and the denied and expired paths.

---

# World integration (GoHealthMe V4, ETHGlobal Tokyo 2026)

Two World tracks, two seams. IDKit sits at the join (one human, one entry;
written by the world-idkit lane above this line when it lands). World ID for
Agents sits at the payout, below. Neither proves a goal was met: the wearable
read and SPOTTER's verdict do that. World answers "who" at the join and
"did the payee consent" at the payout, nothing more.

## World ID for Agents

### The protected action

SPOTTER (`app/lib/server/agent/run.ts`) reads the evidence, decides "pay",
records the PASS on chain, and settles. The record write is the protected
action: it is what lets `HealthPoolsV3.settle()` move USDC to the achiever.
Before V4 nothing human sat between the decision and that write.

With `WORLD_APPROVAL_MODE` set, a pay decision stops at an AUTHORIZE gate:

1. **Request.** SPOTTER opens an approval request for the goal (TTL 90s) and
   appends a ledger row `approval: requested` ("asked you to confirm"). The run
   returns `awaiting-approval`. Nothing is on chain.
2. **Human completes.** The claim screen mounts `HumanApprovalCard`. The card
   picks the request up (`POST /api/agent/approval/request`, wallet-signed,
   idempotent), shows the countdown, and runs the fresh verification: the
   mocked proof in event mode, IDKit's request widget against a server-signed
   `rp_context` in world mode.
3. **Validated result, server-side.** `POST /api/agent/approval/complete`
   (wallet-signed; the signer must be the achiever) hands the proof to the
   provider. The action (`settle`) and the signal binding to this payout are
   checked, the proof is verified (mock shape, or World's
   `POST /api/v4/verify/{rp_id}` with the environment pinned from env), and
   the nullifier is consumed once for this payout. The ledger gets
   `approval: approved` with a 10-character nullifier stub.
4. **Protected action.** The browser's next poll of the run route finds the
   approval, records the PASS (both writes) and settles when the pool period
   allows, asserting on `AchieverPaid` as before.

### The unsuccessful paths (the action does not occur)

All four leave no record row, so neither the run loop nor the cron sweep
(`app/api/agent/sweep`, which settles recorded claims only) can pay the claim.
The stake comes back through the contract's unadjudicated refund at settle.

| Path | How it happens | Ledger row | Run status | Screen |
|---|---|---|---|---|
| Declined | "Not now, do not pay" on the card | `approval: declined` | `approval-declined` | "you said no. nothing moved." with Ask again |
| Expired | 90s pass with no answer (materialized lazily by the next read) | `approval: expired` | `approval-expired` | "the window closed before you answered. nothing moved." with Ask again |
| Cancelled | the pool settled while the ask was open | `approval: cancelled` | `approval-cancelled` | "the pool settled before you confirmed. nothing moved." no retry, because none would work |
| Refused proof | wrong action, proof for a different payout (signal), wrong wallet, World says no, reused nullifier | none; request stays pending | `awaiting-approval` | the error line on the card, widget retryable inside the window |

"Ask again" opens attempt+1 with a new signal, so it needs a new proof.
SPOTTER itself asks once per decision and never nags after a decline.

### Action, signal and replay

World ID 4.0 verifies proofs only for actions created in the Developer Portal
(https://docs.world.org/world-id/4-0-migration.md), so the payout
confirmation uses ONE static action for every payout:

- **Action: `settle`.** Registered in the Portal for production and staging,
  next to `prove-human`. `WORLD_APPROVAL_ACTION` overrides it; the value must
  be a Portal action of the configured app. The server signs `rp_context` over
  this action (`signRequest`, key never leaves the server) and the widget asks
  for a proof against the same action from the request route's response.
- **Signal: `<goalId lowercase>:<attempt>`.** This is what names the payout.
  The request route returns it as `signal`; the widget passes it as the IDKit
  signal (`proofOfHuman({ signal })`), and World hashes it into
  `responses[0].signal_hash`. On complete, the server requires
  `responses[0].signal_hash === hashSignal(expectedSignal)` (the same
  `hashSignal` from `@worldcoin/idkit-core/hashing` the prove-human lane uses)
  BEFORE calling World. A proof with no signal_hash, or one made for another
  goal or another attempt, is refused: a proof for one payout can never
  approve another.
- **Replay key: `agent-approval-nullifier:<action>:<goalId>:<attempt>:<nullifier>`.**
  With a static action a human's nullifier is identical on every payout, so
  the one-shot `setNx` key is scoped to the payout. The same proof twice for
  the same payout is refused; the same human confirming a new payout (another
  goal, or attempt 2 after a decline or expiry) is allowed.

The mock provider mirrors all three: the mock proof carries `action` and
`signal`, both are checked, and the mock nullifier depends only on wallet and
action, like a real one.

### What an approval proves, and does not

An approved row proves one human consented to this payout, within the window.
It does not prove the goal, does not re-check the wearable, and carries no
health data: the action is `settle` and the signal is `<goalId>:<attempt>`.
The nullifier is stored server-side for the one-shot check; the ledger, the
receipt and the public feed see a stub at most. The comments in `approval-provider.ts`,
`approval.ts`, `ledger.ts` and `HumanApprovalCard.tsx` say the same.

### What is mocked

The prize page says proofs are mocked at this event and there is no sandbox
app. `WORLD_APPROVAL_MODE=mock` is that event mode: the browser sends
`{ kind: "gohealthme-mock-approval", action, signal, approve: true }`, the
server checks the action and signal binding and derives a deterministic
stand-in nullifier (sha256 of wallet plus action), and the card is labelled "event mode, mocked
proofs (not production)". A mocked proof proves nothing about anybody. It
exists so the whole journey, including every refusal path and the wallet
signature that guards both routes, runs end to end before the event
environment is configured. Never ship it past the hackathon.

`WORLD_APPROVAL_MODE=world` is the live path: `@worldcoin/idkit` 4.3.0
(`signRequest` from `@worldcoin/idkit/signing` on the server,
`IDKitRequestWidget` with `proofOfHuman({ signal })`, signal `<goalId>:<attempt>`,
in the browser),
and World's v4 verify endpoint. It is built from the docs fetched on
2026-09-26 (human-in-the-loop integrate and SDK reference, the verify
reference, the RP signatures page) and has NOT been exercised against a real
relying party yet; that is the booth step below.

### Files

| File | Role |
|---|---|
| `app/lib/server/agent/approval-provider.ts` | mode switch, mock provider, world provider (signRequest, verify, nullifier) |
| `app/lib/server/agent/approval.ts` | approval records, state machine, lazy expiry, one-shot nullifier, `approvalGate` |
| `app/lib/server/agent/run.ts` | the fenced `world-agents` AUTHORIZE block between REASON and RECORD; four new `RunStatus` values |
| `app/lib/server/agent/ledger.ts` | ledger kind `approval` |
| `app/app/api/agent/approval/{request,complete,status}/route.ts` | the three routes |
| `app/components/world/HumanApprovalCard.tsx`, `WorldApprovalWidget.tsx` | the card and the lazily loaded IDKit widget |
| `app/lib/world/approval-client.ts` | browser-side helpers, mock proof mirror, copy for each outcome |
| `app/lib/agent-receipt.ts`, `app/lib/claim-rail.ts`, `app/lib/server/agent/feed-view.ts`, `app/components/AgentReceipt.tsx` | fenced blocks: receipt rows, run status from the ledger, rail mapping, public feed machine state |

### Env

| Variable | Where | Meaning |
|---|---|---|
| `WORLD_APPROVAL_MODE` | server | `mock` (event mode), `world` (live), unset (gate off, pre-Tokyo behaviour). Any other value throws. |
| `WORLD_APPROVAL_TTL_S` | server | request window in seconds, default 90, clamped to 10..600 |
| `WORLD_APPROVAL_ACTION` | server | the Portal action payout proofs are made against; default `settle` |
| `NEXT_PUBLIC_WORLD_APP_ID` | server and browser | `app_...` from the Developer Portal (the event environment's app) |
| `WORLD_RP_ID` | server | relying party id, `rp_...` |
| `WORLD_RP_SIGNING_KEY` | server only | hex RP signing key; signs `rp_context`; never reaches the browser. Shared with prove-human. The older name `WORLD_SIGNING_KEY` is still read as a fallback. |
| `WORLD_ENVIRONMENT` | server | `staging` (default), `sandbox` or `production`; pinned into every verify call, the client's value is discarded |
| `WORLD_VERIFY_URL` | server | default `https://developer.world.org/api/v4/verify`; override if the event environment hosts its own verifier |
| `WORLD_ALLOW_LEGACY_PROOFS` | server | `true` to accept v3 proofs in the widget; default `false` |

Missing world-mode variables fail closed: the run appends an `error` row with
the variable name (stage `approval`) and records nothing; the routes answer
503 with a plain message. Nothing ever falls back to mock on its own.

### Switching from mock to the event environment (Saturday, World booth)

Ask, in this order, and set the variables on Vercel and in `app/.env.local`:

1. Is the event's World ID for Agents environment the human-in-the-loop
   pattern (IDKit request widget plus `POST /api/v4/verify/{rp_id}`), or
   AgentKit (x402 agent registration)? This build is the former; if the booth
   says the latter, the provider seam is where an AgentKit provider goes.
2. The `app_id`, `rp_id` and RP signing key for the event environment, and
   which `environment` value (`staging`, `sandbox` or `production`) the mocked
   proofs verify under. Set `NEXT_PUBLIC_WORLD_APP_ID`, `WORLD_RP_ID`,
   `WORLD_SIGNING_KEY`, `WORLD_ENVIRONMENT`.
3. Does the verifier live at `developer.world.org/api/v4/verify`, or does the
   event host its own? If its own, set `WORLD_VERIFY_URL`.
4. Do the mocked proofs come back as v4 (`protocol_version: "4.0"`, the
   default) or v3? If v3, set `WORLD_ALLOW_LEGACY_PROOFS=true`.
5. Then set `WORLD_APPROVAL_MODE=world`, redeploy, and run the demo path once
   with the denied path first. If any answer breaks the seam, leave
   `WORLD_APPROVAL_MODE=mock` for the demo and say so in the submission.

### Tests

`app/lib/server/agent/approval-provider.test.ts` (mode switch, mock
determinism, world signing and verify, env fails closed),
`app/lib/server/agent/approval.test.ts` (state machine, one active request,
lazy expiry, replay, cancel, gate), `app/lib/server/agent/run.approval.test.ts`
(gate off is byte-for-byte the old loop; awaiting, approved, declined,
expired, cancelled, misconfigured), `app/app/api/agent/sweep/route.world-agents.test.ts`
(sweep never settles an unapproved PASS),
`app/app/api/agent/approval/routes.test.ts` (signature required, stranger
refused, full journey, denied journey, refused proof, expiry through status),
`app/lib/world/approval-client.test.ts` (wire-format mirror, countdown, copy).

### Who is worse off after this change

- **An achiever who never answers.** With the mode on, a verified PASS is not
  paid until the human confirms. If they close the tab, the request expires,
  nothing is recorded, and the stake comes back at period end instead of the
  reward. The claim screen shows this as a real state with "Ask again", and
  the run reports `approval-expired`; it is never silent. This is the intended
  cost of the human step and it must be said at the join, before the stake:
  the join surface (UX lane) needs one line, "SPOTTER will ask you to confirm
  with World ID before it pays; no confirmation, no payout, stake refunded".
- **An achiever whose pool settles while they are away.** Same outcome as
  before this change (settle is one-shot), now with an honest "cancelled"
  screen instead of a record error.
- **Nobody, when the mode is unset.** The gate returns before touching the
  store, and the run tests pin the ledger sequence to the pre-Tokyo one.
