# Lane contracts for the ETHGlobal Tokyo 2026 build

Five lanes build in parallel from the same base commit, each in its own git worktree and branch. This file is the contract between them. A lane edits only what it owns; anything it needs from another lane it takes through the interfaces below. Read `CLAUDE.md` first.

## Branches and ownership

| Lane | Branch | Owns (edit freely) | Never edits |
|---|---|---|---|
| foundation | `lane/foundation` | `app/lib/server/agent/spotter.ts` settle preflight, `app/lib/server/agent/run.ts` attester-role check, `app/lib/server/verdict.ts`, their tests | screens, components |
| world-idkit | `lane/world-idkit` | `app/lib/server/world/**` (new), `app/app/api/world/**` (new), `app/components/world/ProveHuman.tsx`, `app/lib/world/useHumanStatus.ts`, `app/lib/server/access.ts` (approval-by-World), `docs/WORLD.md` | `AccessGate.tsx`, `Header.tsx`, pages |
| world-agents | `lane/world-agents` | `app/lib/server/agent/approval.ts` (new), `app/lib/server/agent/ledger.ts` (add a kind), `app/app/api/agent/approval/**` (new), `app/components/world/HumanApprovalCard.tsx`, the pay-decision gate in `run.ts` (one block, see shared files), `docs/WORLD.md` (agents section) | screens, `spotter.ts` |
| ens | `lane/ens` | `app/lib/ens/**`, `app/lib/server/ens/**` (new), `app/app/api/ens/**` (new), `app/components/ens/**`, `app/lib/server/social-profile.ts` (claim writes the subname), `scripts/ens-bootstrap.ts`, the receipt write after settle (one block in `run.ts`), `docs/ENS.md`, `DEPLOYMENTS.md` Tokyo heading | screens |
| intercepta | `lane/intercepta` | `app/lib/server/screening/**` (new), `app/app/api/screen/**` (new), `app/components/intercepta/PayoutScreening.tsx`, the screening call before the settle tx is signed (one block in `spotter.ts`), `docs/INTERCEPTA.md` | screens |
| ux | `lane/ux` | `app/app/**/page.tsx`, `app/components/game/**` (new), `AccessGate.tsx`, `Header.tsx`, `PoolDetail.tsx`, `ChallengeAccept.tsx`, `DashboardContent.tsx`, `ClaimRail.tsx`, `ClaimPayout.tsx`, `RefundClaim.tsx`, `WearableCheck.tsx` copy, `SpotterSays`, `lib/game/**`, styles | any file under `components/world`, `components/ens`, `components/intercepta`, `lib/world`, `lib/server/**` |

Shared files (`run.ts`, `spotter.ts`): each lane adds one clearly fenced block (`// --- <lane> ---` ... `// --- end <lane> ---`) and touches nothing else in the file, so the merges are hunk-clean.

## Component contracts (stubs exist on main; a lane replaces its file wholesale, props stay)

- `components/world/ProveHuman.tsx`: `{ address, onVerified({nullifierHash}), onFailed?(reason) }`. Renders the IDKit widget (staging or the event environment), posts the proof to `POST /api/world/verify`, calls `onVerified` only after the server says ok. Failure and cancel call `onFailed` with a plain-English reason and the widget stays retryable.
- `lib/world/useHumanStatus.ts`: `useHumanStatus(address) -> { status: unknown|verified|unverified, loading, refresh }`, backed by `GET /api/world/status?address=`.
- `components/world/HumanApprovalCard.tsx`: `{ goalId, poolId, address, onResult(approved|declined|expired|cancelled) }`. Requests an approval (`POST /api/agent/approval/request`), runs the fresh verification, completes it (`POST /api/agent/approval/complete`), polls `GET /api/agent/approval/status`, and calls `onResult` once. Shows the countdown to expiry. The declined and expired states are real screens with a retry, never a toast.
- `components/ens/EnsNameClaim.tsx`: `{ address, currentName, onClaimed(name) }`. Availability check, claim `<label>.gohealthme.eth` on Sepolia through `POST /api/ens/claim` (signature-gated like the handle claim), shows the Sepolia tx link, calls `onClaimed` when the name resolves.
- `components/ens/EnsName.tsx`: `{ address, fallback?, className? }`. Resolves through `GET /api/ens/resolve?address=` with a small client cache; falls back to the short address.
- `components/intercepta/PayoutScreening.tsx`: `{ status: pending|clear|blocked|unavailable|unconfigured, reason? }`. One line. `unconfigured` reads as "screening not enabled on this deployment", never as an error.
- `lib/game/character.ts` (UX owns): `Character { address, human, name, device }`, `isReadyToPlay`.

## API contracts (server validates everything; nothing trusts the client)

| Route | Lane | Request | Response |
|---|---|---|---|
| `GET /api/world/status?address=` | world-idkit | | `{ human: "verified"|"unverified", verifiedAt?: string }` |
| `POST /api/world/verify` | world-idkit | `{ address, proof }` (IDKit result payload) | `{ ok: true, nullifierHash }` or 401 with a plain reason; second human on the same wallet, or same human on a second wallet, is 409 |
| `POST /api/agent/approval/request` | world-agents | `{ goalId }` + wallet signature | `{ requestId, expiresAt }` (TTL 90s) |
| `POST /api/agent/approval/complete` | world-agents | `{ requestId, proof }` | `{ status: "approved"|"declined"|"expired" }` |
| `GET /api/agent/approval/status?goalId=` | world-agents | | `{ status: "none"|"pending"|"approved"|"declined"|"expired", expiresAt? }` |
| `GET /api/ens/resolve?address=` | ens | | `{ name: string|null }` |
| `GET /api/ens/available?label=` | ens | | `{ available: boolean, reason?: string }` |
| `POST /api/ens/claim` | ens | `{ address, label }` + wallet signature | `{ name, tx }` |
| `GET /api/ens/receipt?poolId=` | ens | | `{ name, records: { settledAt?, settledBy?, txHash? } }` |
| `GET /api/screen/status?goalId=` | intercepta | | `{ status, reason?, checkedAt? }` |

## Rules every lane follows

- Tests for every new module and for every denied or failure branch. `npm test`, `npx tsc --noEmit`, `npx eslint .` green before the lane reports done.
- Commit small, on the lane branch, with real messages. Push the branch. The main session merges in this order: foundation, world-idkit, world-agents, ens, intercepta, ux.
- Env vars: new ones go in `docs/<LANE>.md` with what they are and where they come from; never in git. Missing env fails closed with a visible, honest state, never a 500 with a stack trace.
- Testnet only. Proofs from World are mocked at this event; the code comments and the docs say so.
- Money paths assert on a USDC delta or an emitted event.
- A lane reports: what works, proof (test names, tx hashes, curl output), what is left, which user segments are worse off (or none, checked).
