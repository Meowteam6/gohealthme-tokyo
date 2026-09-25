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
   provider. The action binding is checked, the proof is verified (mock shape,
   or World's `POST /api/v4/verify/{rp_id}` with the environment pinned from
   env), and the nullifier is consumed once. The ledger gets
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
| Refused proof | wrong action, wrong wallet, World says no, reused nullifier | none; request stays pending | `awaiting-approval` | the error line on the card, widget retryable inside the window |

"Ask again" opens attempt+1 with a new action string, so it needs a new proof.
SPOTTER itself asks once per decision and never nags after a decline.

### What an approval proves, and does not

An approved row proves one human consented to this payout, within the window.
It does not prove the goal, does not re-check the wearable, and carries no
health data: the action string is `settle:<goalId>:<attempt>`. The nullifier
is stored server-side for the one-shot check; the ledger, the receipt and the
public feed see a stub at most. The comments in `approval-provider.ts`,
`approval.ts`, `ledger.ts` and `HumanApprovalCard.tsx` say the same.

### What is mocked

The prize page says proofs are mocked at this event and there is no sandbox
app. `WORLD_APPROVAL_MODE=mock` is that event mode: the browser sends
`{ kind: "gohealthme-mock-approval", action, approve: true }`, the server
checks the action binding and derives a deterministic stand-in nullifier
(sha256 of wallet plus action), and the card is labelled "event mode, mocked
proofs (not production)". A mocked proof proves nothing about anybody. It
exists so the whole journey, including every refusal path and the wallet
signature that guards both routes, runs end to end before the event
environment is configured. Never ship it past the hackathon.

`WORLD_APPROVAL_MODE=world` is the live path: `@worldcoin/idkit` 4.3.0
(`signRequest` from `@worldcoin/idkit/signing` on the server,
`IDKitRequestWidget` with `orbLegacy({ signal: address })` in the browser),
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
| `NEXT_PUBLIC_WORLD_APP_ID` | server and browser | `app_...` from the Developer Portal (the event environment's app) |
| `WORLD_RP_ID` | server | relying party id, `rp_...` |
| `WORLD_SIGNING_KEY` | server only | hex RP signing key; signs `rp_context`; never reaches the browser |
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
