# Sensor Integrations (overlap-only goals, WHOOP for two) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Only offer runs every supported sensor can verify, let Andre and Nikki pair WHOOP directly while everyone else uses Junction, and say plainly what is coming, without adding screens.

**Architecture:** One client-safe capability table (`lib/provider-capabilities.ts`) becomes the single source for what each provider measures; the server providers read their metric lists from it and a derived `LAUNCH_METRICS` (their intersection) drives the create forms. WHOOP visibility is a per-wallet allowlist checked in the providers route, the link route and the WHOOP login route. Pool 3 (steps) is cancelled on chain and replaced by a launch goal.

**Tech Stack:** Next.js 16 App Router, TypeScript, vitest (node env, tests beside sources, `.ts` only), viem, Foundry `cast`, Vercel env via `scripts/v4-env-import.py`.

**Spec:** `docs/superpowers/specs/2026-09-26-sensor-integrations-design.md` (approved 2026-09-26, plus the "Coming: heart-zone runs and document proof" line).

**Deviation from the spec, stated:** the spec says create routes refuse non-launch metrics server-side. The code has no such route: goals are free text written on chain by the client (`CreatePool.tsx:227`, `CreateChallenge.tsx:921`) and classified at read time (`lib/wearable-goal.ts:117`). Enforcement therefore lives in the create form (blocks submit), and the existing join gate (`lib/wearable-join-gate.ts:109`) stays the backstop for any pool created on chain by hand. Dares are document goals (`CreateChallenge.tsx:893-900`) and are unaffected.

## Global Constraints

- Launch goals are the intersection of provider capabilities: today `sleep_hours`, `sleep_efficiency`, `workouts`. Never a hand-kept list.
- Hard rules: seamless UX (no hidden prompt, no dead end, no refusal after a stake); real beta users, no mock in production.
- WHOOP connect is offered only to wallets in `WHOOP_ALLOWED_WALLETS` (comma- or whitespace-separated, case-insensitive), parsed like `ADMIN_ADDRESSES` in `lib/server/access.ts:114`.
- `WHOOP_REDIRECT_URI=https://gohealthme-tokyo.vercel.app/api/whoop/callback`.
- Copy line, verbatim: `Coming: heart-zone runs and document proof.`
- No emojis, no exclamation marks in code or copy. Commit messages end with the two attribution lines used on this repo.
- Run everything from `app/`: `npm test`, `npx tsc --noEmit`, `npx eslint .` (0 errors), `npm run build`.

## Review Focus

1. A wallet not on the WHOOP list calls `/api/wearable/link` or `/api/whoop/login` directly: expect 403 / redirect with a plain outcome, no token stored. (Task 3 tests.)
2. A player already linked to WHOOP whose wallet is later removed from the list: their existing link keeps working for reads (no silent disconnect mid-run). (Task 3 test.)
3. A goal typed with mixed wording ("Sleep 7h", "sleep at least seven hours") that classifies to a launch metric must not be blocked; one that classifies to steps must be blocked with the offered list. (Task 2 tests.)
4. A goal that classifies to no metric at all on a wearable floor: blocked with the same helpful message, not submitted as an unverifiable run. (Task 2 test.)
5. Address casing: allowlist entries in checksum case match a lowercase signed address. (Task 3 test.)

---

### Task 1: Client-safe capability table and LAUNCH_METRICS

**Files:**
- Create: `app/lib/provider-capabilities.ts`
- Create: `app/lib/provider-capabilities.test.ts`
- Modify: `app/lib/server/wearable/whoop.ts:767` (WHOOP_METRICS reads the table)
- Modify: `app/lib/server/wearable/junction-provider.ts:159` (metrics reads the table)
- Modify: `app/lib/server/wearable/apple.ts:187` (metrics reads the table)

**Interfaces:**
- Produces: `PROVIDER_CAPABILITIES: Record<ProviderId, readonly WearableMetric[]>`, `LAUNCH_METRICS: readonly WearableMetric[]`, `isLaunchMetric(m: WearableMetric): boolean`, `launchGoalsSentence(): string`, `COMING_LINE: string`.

- [ ] **Step 1: Write the failing test** (`app/lib/provider-capabilities.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import {
  PROVIDER_CAPABILITIES,
  LAUNCH_METRICS,
  isLaunchMetric,
  launchGoalsSentence,
  COMING_LINE,
} from "@/lib/provider-capabilities";

describe("provider capabilities", () => {
  it("launch goals are the intersection of every provider", () => {
    const all = Object.values(PROVIDER_CAPABILITIES);
    const expected = all[0].filter((m) => all.every((list) => list.includes(m)));
    expect([...LAUNCH_METRICS].sort()).toEqual([...expected].sort());
  });

  it("is sleep hours, sleep efficiency and workouts today", () => {
    expect([...LAUNCH_METRICS].sort()).toEqual(["sleep_efficiency", "sleep_hours", "workouts"]);
    expect(isLaunchMetric("steps")).toBe(false);
    expect(isLaunchMetric("sleep_score")).toBe(false);
  });

  it("WHOOP cannot measure steps, Apple cannot give a sleep score", () => {
    expect(PROVIDER_CAPABILITIES.whoop).not.toContain("steps");
    expect(PROVIDER_CAPABILITIES.apple).not.toContain("sleep_score");
  });

  it("has plain copy", () => {
    expect(launchGoalsSentence()).toBe("sleep hours, sleep efficiency or workouts");
    expect(COMING_LINE).toBe("Coming: heart-zone runs and document proof.");
  });
});
```

- [ ] **Step 2: Run it, expect FAIL** (module not found)

Run: `npx vitest run lib/provider-capabilities.test.ts`

- [ ] **Step 3: Implement** (`app/lib/provider-capabilities.ts`)

```ts
// What each wearable provider can verify, in one client-safe place. The server
// providers read their metric lists from here, and the create forms offer only
// LAUNCH_METRICS: the goals every provider can verify, so no player meets a run
// their sensor cannot count (spec 2026-09-26-sensor-integrations-design.md).
import type { ProviderId } from "@/lib/wearable-providers";
import { metricLabel, type WearableMetric } from "@/lib/wearable-goal";

export const PROVIDER_CAPABILITIES: Record<ProviderId, readonly WearableMetric[]> = {
  junction: ["sleep_score", "sleep_efficiency", "sleep_hours", "steps", "active_calories", "distance_km", "workouts"],
  // A WHOOP strap has no pedometer; its calories include basal burn.
  whoop: ["sleep_score", "sleep_efficiency", "sleep_hours", "workouts"],
  // Apple publishes no proprietary sleep score.
  apple: ["sleep_efficiency", "sleep_hours", "steps", "active_calories", "distance_km", "workouts"],
};

const lists = Object.values(PROVIDER_CAPABILITIES);

export const LAUNCH_METRICS: readonly WearableMetric[] = lists[0].filter((metric) =>
  lists.every((list) => list.includes(metric)),
);

export function isLaunchMetric(metric: WearableMetric): boolean {
  return LAUNCH_METRICS.includes(metric);
}

/** "sleep hours, sleep efficiency or workouts" */
export function launchGoalsSentence(): string {
  const labels = LAUNCH_METRICS.map((m) => metricLabel(m).toLowerCase());
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

export const COMING_LINE = "Coming: heart-zone runs and document proof.";
```

If `metricLabel` returns labels that differ from "Sleep hours" / "Sleep efficiency" / "Workouts", adjust the expected sentence in the test to the real labels (read `lib/wearable-goal.ts:59` first); the order must follow `LAUNCH_METRICS`.

- [ ] **Step 4: Point the server providers at the table.** In `whoop.ts:767` replace the literal with `const WHOOP_METRICS = PROVIDER_CAPABILITIES.whoop;`; in `junction-provider.ts:159` use `metrics: PROVIDER_CAPABILITIES.junction,`; in `apple.ts:187` use `metrics: PROVIDER_CAPABILITIES.apple,`. Import from `@/lib/provider-capabilities`. Keep order identical to what each file had.

- [ ] **Step 5: Run** `npx vitest run lib/provider-capabilities.test.ts lib/server/wearable` then `npx tsc --noEmit`. Expected: PASS, no type errors.

- [ ] **Step 6: Commit** `feat(wearable): one capability table and the launch goals it implies`

---

### Task 2: Create-run offers only launch goals

**Files:**
- Create: `app/lib/launch-goal-check.ts`
- Create: `app/lib/launch-goal-check.test.ts`
- Modify: `app/components/CreatePool.tsx` (submit guard near L163, notice after L410, chips near the goal textarea L398-415)

**Interfaces:**
- Consumes: `classifyWearableGoal(goalSpec: string): WearableSpec` (`lib/wearable-goal.ts:117`), `isLaunchMetric`, `launchGoalsSentence`, `COMING_LINE` (Task 1).
- Produces: `launchGoalIssue(goalSpec: string): string | null`, `LAUNCH_GOAL_EXAMPLES: readonly string[]`.

- [ ] **Step 1: Failing test** (`app/lib/launch-goal-check.test.ts`)

```ts
import { describe, it, expect } from "vitest";
import { launchGoalIssue, LAUNCH_GOAL_EXAMPLES } from "@/lib/launch-goal-check";
import { classifyWearableGoal } from "@/lib/wearable-goal";

describe("launch goal check", () => {
  it("accepts each launch goal however it is worded", () => {
    for (const goal of [
      "Sleep at least 7 hours for 1 night",
      "Complete at least 1 workout for 1 day",
      "Sleep efficiency 85% or better for 3 nights",
    ]) {
      expect(launchGoalIssue(goal)).toBeNull();
    }
  });

  it("blocks a steps goal and names what is offered", () => {
    const issue = launchGoalIssue("Walk at least 8,000 steps for 1 day");
    expect(issue).toMatch(/every sensor/);
    expect(issue).toMatch(/sleep hours, sleep efficiency or workouts/);
  });

  it("blocks a goal no sensor can read", () => {
    expect(launchGoalIssue("Be nicer to people")).toMatch(/sleep hours, sleep efficiency or workouts/);
  });

  it("every example chip classifies to a launch goal", () => {
    for (const example of LAUNCH_GOAL_EXAMPLES) {
      expect(classifyWearableGoal(example).metric).not.toBeNull();
      expect(launchGoalIssue(example)).toBeNull();
    }
  });
});
```

- [ ] **Step 2: Run, expect FAIL.** `npx vitest run lib/launch-goal-check.test.ts`

- [ ] **Step 3: Implement** (`app/lib/launch-goal-check.ts`)

```ts
// The create-form guard for wearable runs: a run is offered only if every
// supported sensor can verify it. Goals are free text written on chain by the
// client, so this is where the rule is enforced; the join gate stays the
// backstop for pools created on chain by hand.
import { classifyWearableGoal } from "@/lib/wearable-goal";
import { isLaunchMetric, launchGoalsSentence } from "@/lib/provider-capabilities";

export const LAUNCH_GOAL_EXAMPLES: readonly string[] = [
  "Sleep at least 7 hours for 1 night",
  "Complete at least 1 workout for 1 day",
  "Sleep efficiency 85% or better for 3 nights",
];

export function launchGoalIssue(goalSpec: string): string | null {
  const { metric } = classifyWearableGoal(goalSpec);
  if (metric !== null && isLaunchMetric(metric)) return null;
  return `Runs have to work with every sensor, so pick ${launchGoalsSentence()}.`;
}
```

If a wording in the test does not classify (check `classifyWearableGoal` at `lib/wearable-goal.ts:117`), change the test wording and the example chip to the phrasing it does recognise; never widen the classifier in this task.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Wire into `CreatePool.tsx`.** Only when `floor === "wearable"`:
  - compute `const goalIssue = floor === "wearable" ? launchGoalIssue(goalSpec) : null;`
  - disable submit and show `goalIssue` under the textarea when non-null (reuse the file's existing error text element style; read L398-415);
  - render the three `LAUNCH_GOAL_EXAMPLES` as small buttons above the textarea that set `goalSpec` on tap (plain `button`, `text-xs`, existing chip styling if the file has one);
  - after `<AuthorCapabilityNotice …/>` (L410) add `<span className="mt-1 block text-xs text-muted">{COMING_LINE}</span>`;
  - replace the L300 copy "Verified from connected device metrics like sleep or steps." with "Verified from any connected sensor: sleep hours, sleep efficiency or workouts." (steps is no longer offered).

- [ ] **Step 6: Run** `npm test`, `npx tsc --noEmit`, `npx eslint .`. Expected: green.

- [ ] **Step 7: Commit** `feat(create): wearable runs offer only goals every sensor can verify`

---

### Task 3: WHOOP allowlist (server) and env

**Files:**
- Create: `app/lib/server/wearable/whoop-allowlist.ts`
- Create: `app/lib/server/wearable/whoop-allowlist.test.ts`
- Modify: `app/app/api/wearable/providers/route.ts` (L45-57 no-address branch, L74 address branch)
- Modify: `app/app/api/wearable/link/route.ts` (inside `if (providerId === "whoop")`, L77)
- Modify: `app/app/api/whoop/login/route.ts` (after the ticket null check, L77-82)
- Modify: `app/app/api/wearable/link/route.test.ts`, `app/app/api/whoop/login/route.test.ts` (new cases)
- Modify: `scripts/v4-env-import.py` (carry WHOOP vars)

**Interfaces:**
- Produces: `whoopAllowedWallets(): string[]`, `whoopAllowedFor(address: string | null): boolean`.

- [ ] **Step 1: Failing test** (`whoop-allowlist.test.ts`)

```ts
import { describe, it, expect, afterEach, vi } from "vitest";
import { whoopAllowedFor, whoopAllowedWallets } from "@/lib/server/wearable/whoop-allowlist";

afterEach(() => vi.unstubAllEnvs());

const A = "0x8a39a5160Bad34713169ad7eEf9bd779b32c6141";

describe("WHOOP allowlist", () => {
  it("is empty and allows nobody when unset", () => {
    vi.stubEnv("WHOOP_ALLOWED_WALLETS", "");
    expect(whoopAllowedWallets()).toEqual([]);
    expect(whoopAllowedFor(A)).toBe(false);
  });

  it("matches regardless of case and separators", () => {
    vi.stubEnv("WHOOP_ALLOWED_WALLETS", `${A}, 0x1111111111111111111111111111111111111111`);
    expect(whoopAllowedFor(A.toLowerCase())).toBe(true);
    expect(whoopAllowedFor("0x2222222222222222222222222222222222222222")).toBe(false);
    expect(whoopAllowedFor(null)).toBe(false);
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`whoop-allowlist.ts`)

```ts
// WHOOP's developer app is capped at 10 members on its sandbox tier, so WHOOP
// pairing is offered only to named wallets (Andre and Nikki). Everyone else
// pairs through Junction, which also covers WHOOP straps. Parsed like
// ADMIN_ADDRESSES in lib/server/access.ts.
export function whoopAllowedWallets(): string[] {
  return (process.env.WHOOP_ALLOWED_WALLETS ?? "")
    .split(/[\s,]+/)
    .map((s) => s.trim().toLowerCase())
    .filter((s) => /^0x[0-9a-f]{40}$/.test(s));
}

export function whoopAllowedFor(address: string | null): boolean {
  if (address === null) return false;
  return whoopAllowedWallets().includes(address.toLowerCase());
}
```

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Gate the routes.**
  - `providers/route.ts`: for the `whoop` entry, `configured` becomes `providerConfigured("whoop") && whoopAllowedFor(address)`; in the no-address branch it is `false`. An already-connected WHOOP wallet keeps `connected: true` and its capability (Review Focus 2), so only new pairing is hidden.
  - `link/route.ts` inside `if (providerId === "whoop")`: if `!whoopAllowedFor(auth.address)` return `jsonError(403, "WHOOP pairing is in private beta. Pair through Junction instead; it covers WHOOP straps too.")` before minting the ticket.
  - `whoop/login/route.ts` after the ticket null check: if `!whoopAllowedFor(ticket.address)` return `backToDashboard(request, "whoop-not-allowed", returnPath)`; add the outcome's copy wherever the other `?whoop=` outcomes are rendered (SensorStep and WearableCheck read them; search for `"whoop-denied"` or the existing outcome keys and add `"whoop-not-allowed"` with the same sentence).

- [ ] **Step 6: Route tests.** In `link/route.test.ts` add: allowlisted wallet mints a ticket; other wallet gets 403 and no ticket is written. In `whoop/login/route.test.ts` add: ticket for a non-allowlisted wallet redirects with `whoop=whoop-not-allowed` and never calls the WHOOP authorize URL. Stub `WHOOP_ALLOWED_WALLETS` with `vi.stubEnv`.

- [ ] **Step 7: Env.** In `app/.env.local` set `WHOOP_REDIRECT_URI=https://gohealthme-tokyo.vercel.app/api/whoop/callback` and `WHOOP_ALLOWED_WALLETS=0x8a39a5160Bad34713169ad7eEf9bd779b32c6141,<Nikki's wallet>`. In `scripts/v4-env-import.py` add `WHOOP_CLIENT_ID`, `WHOOP_CLIENT_SECRET`, `WHOOP_REDIRECT_URI`, `WHOOP_ALLOWED_WALLETS` to the `want` map from `local`. Andre runs the import (sessions cannot write Vercel secrets). Nikki's wallet address is a founder input; until it is known only Andre's wallet is listed.

- [ ] **Step 8: Run** `npm test`, `npx tsc --noEmit`, `npx eslint .`. Commit `feat(whoop): pair WHOOP only for allowlisted wallets; Junction for everyone else`.

---

### Task 4: Pairing card copy

**Files:**
- Modify: `app/components/game/SensorStep.tsx` (`measuresLine` L49, card L264-282, note L287-293)
- Create: `app/lib/game/sensor-copy.ts` and `app/lib/game/sensor-copy.test.ts`

**Interfaces:**
- Consumes: `PROVIDER_CAPABILITIES`, `LAUNCH_METRICS`, `COMING_LINE` (Task 1).
- Produces: `countsLine(provider: ProviderId): string`.

- [ ] **Step 1: Failing test**

```ts
import { describe, it, expect } from "vitest";
import { countsLine } from "@/lib/game/sensor-copy";

describe("pairing card line", () => {
  it("lists only launch goals the provider counts", () => {
    expect(countsLine("whoop")).toBe("Counts sleep hours, sleep efficiency and workouts.");
    expect(countsLine("junction")).toBe("Counts sleep hours, sleep efficiency and workouts.");
  });
});
```

- [ ] **Step 2: Run, expect FAIL.**

- [ ] **Step 3: Implement** (`app/lib/game/sensor-copy.ts`)

```ts
import type { ProviderId } from "@/lib/wearable-providers";
import { metricLabel } from "@/lib/wearable-goal";
import { LAUNCH_METRICS, PROVIDER_CAPABILITIES } from "@/lib/provider-capabilities";

/** One line per sensor: which offered goals it counts. Apple's Watch caveat
 *  stays in the existing per-device hold, not here. */
export function countsLine(provider: ProviderId): string {
  const labels = LAUNCH_METRICS.filter((m) => PROVIDER_CAPABILITIES[provider].includes(m)).map((m) =>
    metricLabel(m).toLowerCase(),
  );
  if (labels.length === 0) return "Counts none of the current runs yet.";
  const list = labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Counts ${list}.`;
}
```

Adjust expected strings to the real `metricLabel` output if it differs.

- [ ] **Step 4: Run, expect PASS.**

- [ ] **Step 5: Wire.** In `SensorStep.tsx` replace the body of `measuresLine(option)` (L49) with `countsLine(option.id)` so each card shows one line, and add `<p className="text-sm text-muted">{COMING_LINE}</p>` beside the `appleNotYet` note (L287-293), rendered always.

- [ ] **Step 6: Run** tests, tsc, eslint, `npm run build`. Commit `feat(pairing): one plain line per sensor and what is coming`.

---

### Task 5: Replace pool 3 on chain

**Files:**
- Modify: `scripts/tokyo-deploy.sh` (L74-76 pool 3 definition)
- Modify: `DEPLOYMENTS.md` (Tokyo heading, via the script log)

- [ ] **Step 1: Confirm pool 3 is empty.** `TOKYO_POOLS=0x0B6E8D477313599aBB746218a1AE45BAb333A12F ./scripts/tokyo-status.sh` must show pool 3 `participants 0`. If not zero, stop and report (cancelling would refund joiners; that is a founder call).

- [ ] **Step 2: Cancel.** From the repo root with `contracts/.env` sourced:

```bash
cast send 0x0B6E8D477313599aBB746218a1AE45BAb333A12F "cancelPool(uint256)" 2 \
  --private-key "$PRIVATE_KEY" --rpc-url https://sepolia.base.org
```

(The script log shows on-chain ids 0, 1, 2 for pools 1, 2, 3; verify the id of "Walk 8k steps today" with `cast call ... "getPool(uint256)" 2` before sending.) Expect a `PoolCancelled` event in the receipt.

- [ ] **Step 3: Redefine pool 3** in `tokyo-deploy.sh` L74-76:

```bash
POOL3_INIT="Sleep efficiency 85 tonight"
POOL3_GOAL="Sleep efficiency 85% or better for 1 night"
```

Keep `POOL3_END` default; confirm the goal classifies to `sleep_efficiency` with a one-off `npx tsx -e 'import {classifyWearableGoal} from "./lib/wearable-goal"; console.log(classifyWearableGoal("Sleep efficiency 85% or better for 1 night"))'` from `app/`.

- [ ] **Step 4: Seed.** `TOKYO_POOLS=0x0B6E8D477313599aBB746218a1AE45BAb333A12F ./scripts/tokyo-deploy.sh`. The old initiative no longer matches, so only the new pool is created. Confirm with `tokyo-status.sh`.

- [ ] **Step 5: Commit** `deploy: cancel the steps run and seed a sleep-efficiency run` (script + DEPLOYMENTS.md).

---

### Task 6: Deploy and drive it

- [ ] **Step 1:** Andre runs `python3 scripts/v4-env-import.py` (WHOOP vars now carried).
- [ ] **Step 2:** `vercel deploy --prod --yes` from `app/`.
- [ ] **Step 3: Drive on a real phone (main session, browser):** Andre's wallet sees WHOOP on the pairing card with "Counts sleep hours, sleep efficiency and workouts."; pairs WHOOP through OAuth; lands back on pairing with WHOOP connected; the lobby shows the three runs with no lock; a second wallet not on the list sees only Junction; `/pools/create` offers the three example chips, blocks "8k steps", and shows the Coming line.
- [ ] **Step 4:** Log evidence in the MI6 ledger done log; update `docs/EVALUATE.md` known limits.
