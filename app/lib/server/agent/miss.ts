// The miss rule: when SPOTTER may record verdict=false for a player.
//
// DECISION (Andre, 2026-09-26): V4 runs the commitment model for real. On a
// model-2 pool a recorded miss forfeits the stake to the players who hit, so a
// wrong miss takes somebody's money. The rule is therefore one-sided on
// purpose: SPOTTER records a miss ONLY when every gate below holds, and
// anything short of that records nothing, which settle() turns into a refund
// (HealthPoolsV3 B-2). Never forfeit on absence of data.
//
//   1. the pool can record a miss (lib/miss-rule.ts): commitment model,
//      wearable only, a metric whose day is final, a goal whose count is said
//      once and read the same way by the pass path, created at or after
//      MISS_RULE_FROM_POOL_ID.
//   2. the run is over and MISS_GRACE_HOURS have passed since periodEnd.
//   3. the player joined, has no result on chain, and SPOTTER has not decided
//      to pay them (a pass waiting on its World ID OK is never overwritten).
//   4. the provider PINNED for this run (the wallet's choice at periodStart,
//      lib/server/wearable pinnedProviderId) is configured, measures this
//      metric and can place its data on the wearer's calendar. A provider
//      switch after the run starts does not change which data is read, so
//      repointing the wallet cannot turn real data into "no data".
//   5. COVERAGE on the wearer's local window W (every local date from
//      periodStart to periodEnd, in the offset of their newest record):
//        sleep     every day in W carries a value > 0 and none is partial
//                  (no-data time on the strap, or only a nap or short sleep);
//        workouts  the source that records workouts reported every day in W
//                  AND something dated after W's last day (proof it synced
//                  after the window closed), and no linked source is unusable.
//   6. NOT MET: over W, and over W widened by one day on each side (the
//      timezone hedge, always in the player's favour), the count is below the
//      goal. Session goals ("2 times") count sessions, not days.
//   7. NOT PAYABLE: the pass rule over the same evidence (runProgress, which
//      the pass path itself runs) says not met, and so does the wallet's
//      current provider when it differs from the pinned one. SPOTTER never
//      forfeits a player its own pass path would pay.
//
// The pure core (missRulePool, missPreconditions, judgeMissEvidence,
// passProgressOf) decides; evaluateMiss is the I/O shell around it and never
// throws: any failure is a skip, and a skip records nothing.

import type { Address } from "viem";
import type { LedgerEntry } from "@/lib/server/agent/ledger";
import type {
  MetricProgress,
  MissEvidence,
  ProviderId,
  WearableProvider,
} from "@/lib/server/wearable/types";
import type { WearableMetric } from "@/lib/wearable-goal";
import { missRulePool, MISS_METRICS, type MissPoolBasis, type MissSpec } from "@/lib/miss-rule";
import { MISS_PHASE_MAX_S } from "@/lib/miss-grace";

export { MISS_METRICS, missRulePool, type MissSpec } from "@/lib/miss-rule";
export { MISS_PHASE_MAX_S } from "@/lib/miss-grace";

const SLEEP_METRICS: readonly WearableMetric[] = [
  "sleep_score",
  "sleep_efficiency",
  "sleep_hours",
];

const DAY_S = 86_400;

export interface MissPool {
  /** The on-chain pool id: the miss rule applies from MISS_RULE_FROM_POOL_ID. */
  id: bigint;
  bountyModel: number;
  goalSpec: string;
  settled: boolean;
  cancelled: boolean;
  periodStart: bigint;
  periodEnd: bigint;
}

export type MissSkipBasis =
  | "pool-closed"
  | MissPoolBasis
  | "grace"
  | "not-joined"
  | "already-recorded"
  | "pass-in-progress"
  | "no-stored-provider"
  | "provider-unconfigured"
  | "metric-unsupported"
  | "not-connected"
  | "tz-unknown"
  | "goal-longer-than-window"
  | "coverage-gap"
  | "no-sync-after-window"
  | "source-unhealthy"
  | "met"
  | "met-at-boundary"
  /** The goal counts sessions and they add up, but the pass path counts
   *  days and would not pay: no miss, and nobody to wait for. */
  | "met-by-sessions"
  /** The pinned provider shows the hit, but the wallet has since switched
   *  and the pass path, which reads the current provider, would not pay:
   *  no miss, and nobody to wait for. */
  | "met-on-pinned-only"
  | "read-error";

/**
 * When a pool that can record a miss may settle: not before periodEnd + grace
 * (dueAt), and after that only once the miss phase finished it, or once
 * holdUntil passes. Null for every other pool, which keeps its old timing.
 */
export function missSettleWindow(
  pool: { id: bigint; bountyModel: number; goalSpec: string; periodEnd: bigint },
  graceSec: number,
): { dueAt: bigint; holdUntil: bigint } | null {
  if (!missRulePool(pool).ok) return null;
  const dueAt = pool.periodEnd + BigInt(graceSec);
  return { dueAt, holdUntil: dueAt + BigInt(MISS_PHASE_MAX_S) };
}

/** Gates 1-3, all pure. */
export function missPreconditions(input: {
  pool: MissPool;
  nowSec: bigint;
  graceSec: number;
  participant: { joined: boolean; resultRecorded: boolean };
  ledger: readonly LedgerEntry[];
}): { ok: true; spec: MissSpec } | { ok: false; basis: MissSkipBasis } {
  const { pool, participant, ledger } = input;
  if (pool.settled || pool.cancelled) return { ok: false, basis: "pool-closed" };
  const rule = missRulePool(pool);
  if (!rule.ok) return rule;
  if (input.nowSec < pool.periodEnd + BigInt(input.graceSec)) {
    return { ok: false, basis: "grace" };
  }
  if (!participant.joined) return { ok: false, basis: "not-joined" };
  if (participant.resultRecorded || ledger.some((e) => e.kind === "record")) {
    return { ok: false, basis: "already-recorded" };
  }
  if (ledger.some((e) => e.kind === "reason" && e.decision === "pay")) {
    return { ok: false, basis: "pass-in-progress" };
  }
  return { ok: true, spec: rule.spec };
}

function isoDay(epochSec: number): string {
  return new Date(epochSec * 1000).toISOString().slice(0, 10);
}

function shiftDay(day: string, days: number): string {
  return isoDay(Date.parse(`${day}T00:00:00Z`) / 1000 + days * DAY_S);
}

/** The run's days on the wearer's own calendar, oldest first. */
export function localWindowDays(
  periodStart: bigint,
  periodEnd: bigint,
  tzOffsetSec: number,
): string[] {
  const first = isoDay(Number(periodStart) + tzOffsetSec);
  const last = isoDay(Number(periodEnd) + tzOffsetSec);
  const days: string[] = [];
  for (let day = first; day <= last; day = shiftDay(day, 1)) days.push(day);
  return days;
}

/** Where the evidence read starts: two UTC days before periodStart, which
 *  covers any wearer offset (UTC-12..UTC+14) plus the hedge day. */
export function missEvidenceFromISO(periodStart: bigint): string {
  return isoDay(Number(periodStart) - 2 * DAY_S);
}

export type MissJudgement =
  | { miss: true; window: string[]; qualifyingDays: number }
  | { miss: false; basis: MissSkipBasis };

/** Qualifying count over some days: sessions for a session goal, else days
 *  whose value clears the threshold. */
function qualifyingCount(spec: MissSpec, evidence: MissEvidence, days: string[]): number {
  if (spec.countsSessions) {
    return days.reduce((sum, day) => sum + (evidence.values[day] ?? 0), 0);
  }
  return days.filter((day) => (evidence.values[day] ?? -Infinity) >= spec.threshold).length;
}

/** Gates 5 and 6: coverage, then not met on any reading of the window. */
export function judgeMissEvidence(input: {
  spec: MissSpec;
  periodStart: bigint;
  periodEnd: bigint;
  evidence: MissEvidence;
}): MissJudgement {
  const { spec, evidence } = input;
  if (evidence.tzOffsetSec === null) return { miss: false, basis: "tz-unknown" };
  const window = localWindowDays(input.periodStart, input.periodEnd, evidence.tzOffsetSec);
  if (spec.goalDays > window.length && !spec.countsSessions) {
    return { miss: false, basis: "goal-longer-than-window" };
  }

  // A reading that shows the goal met is a hit whatever else synced: the
  // player is someone SPOTTER should wait for, not a coverage question.
  const qualifyingDays = qualifyingCount(spec, evidence, window);
  if (qualifyingDays >= spec.goalDays) return { miss: false, basis: "met" };

  if (SLEEP_METRICS.includes(spec.metric)) {
    // daysWithSource is not enough here: an unscored night is a sourced day
    // with no value, and it must not count as a night the player slept short.
    // A partial night (no-data time on the strap, or only a nap or a short
    // sleep that day) is not a whole night either, whatever its value says.
    const partial = new Set(evidence.partialDays ?? []);
    const covered = window.every(
      (day) => (evidence.values[day] ?? 0) > 0 && !partial.has(day),
    );
    if (!covered) return { miss: false, basis: "coverage-gap" };
  } else {
    if (evidence.sourceProblem) return { miss: false, basis: "source-unhealthy" };
    // A day with no session is a real zero only when the source that records
    // workouts synced that day. The window's last day is only proven synced
    // by a record dated AFTER it: a heartbeat on the day itself shows only
    // that the device reported after the day began.
    const beats = new Set(evidence.heartbeatDays);
    if (!window.every((day) => beats.has(day))) {
      return { miss: false, basis: "coverage-gap" };
    }
    const last = window[window.length - 1];
    if (!evidence.heartbeatDays.some((day) => day > last)) {
      return { miss: false, basis: "no-sync-after-window" };
    }
  }

  const widened =[shiftDay(window[0], -1), ...window, shiftDay(window[window.length - 1], 1)];
  if (qualifyingCount(spec, evidence, widened) >= spec.goalDays) {
    return { miss: false, basis: "met-at-boundary" };
  }
  return { miss: true, window, qualifyingDays };
}

/**
 * The PASS rule's progress from per-local-day evidence over window W, clipped
 * to the wearer's today. Days are counted as the pass path always has (a day
 * whose value clears the threshold; for workouts every elapsed day is a
 * sourced day, since no session is a real zero). This is what the pass path
 * pays on, so the miss rule and the pass rule read the same nights.
 */
export function passProgressOf(
  metric: WearableMetric,
  threshold: number,
  evidence: MissEvidence,
  window: string[],
  now: Date = new Date(),
): MetricProgress {
  const today = isoDay(Math.floor(now.getTime() / 1000) + (evidence.tzOffsetSec ?? 0));
  const days = window.filter((day) => day <= today);
  const qualifyingDays = days.filter(
    (day) => (evidence.values[day] ?? -Infinity) >= threshold,
  ).length;
  const daysWithData = days.filter((day) => evidence.values[day] !== undefined).length;
  let daysWithSource: number;
  if (metric === "workouts") {
    daysWithSource = days.length;
  } else {
    const sourced = new Set([...(evidence.sourceDays ?? []), ...Object.keys(evidence.values)]);
    daysWithSource = days.filter((day) => sourced.has(day)).length;
  }
  return { qualifyingDays, daysWithData, daysWithSource };
}

/**
 * The pass path's read of one run, shared with the miss rule. A provider that
 * can place its data on the wearer's calendar (getMissEvidence) is read on the
 * wearer's local window W, the same window the miss rule judges; its offset
 * unknown, W falls back to UTC days. A provider that cannot (Apple), or a
 * metric the miss rule never judges (steps, calories, distance), keeps the
 * UTC-day window it always had.
 */
export async function runProgress(
  provider: WearableProvider,
  address: string,
  goal: { metric: WearableMetric; threshold: number },
  periodStart: bigint,
  periodEnd: bigint,
  now: Date = new Date(),
): Promise<{ progress: MetricProgress; window: string[]; evidence: MissEvidence | null }> {
  if (provider.getMissEvidence === undefined || !MISS_METRICS.includes(goal.metric)) {
    const window = localWindowDays(periodStart, periodEnd, 0);
    const progress = await provider.getMetricProgress(
      address,
      goal.metric,
      goal.threshold,
      window[0],
      window[window.length - 1],
    );
    return { progress, window, evidence: null };
  }
  const evidence = await provider.getMissEvidence(
    address,
    goal.metric,
    missEvidenceFromISO(periodStart),
  );
  const window = localWindowDays(periodStart, periodEnd, evidence.tzOffsetSec ?? 0);
  return {
    progress: passProgressOf(goal.metric, goal.threshold, evidence, window, now),
    window,
    evidence,
  };
}

/** The wearable lookups evaluateMiss needs, injectable for tests. */
export interface MissReadDeps {
  /** The provider this run's evidence is read from: the wallet's choice at
   *  periodStart, or the first one it made after (lib/server/wearable). */
  pinnedProviderId(address: string, atSec: bigint): Promise<ProviderId | null>;
  /** The wallet's current explicit choice, which the pass path reads. */
  storedProviderId(address: string): Promise<ProviderId | null>;
  providerConfigured(id: ProviderId): boolean;
  providerById(id: ProviderId): WearableProvider;
}

export type MissDecision =
  | {
      miss: true;
      spec: MissSpec;
      window: string[];
      qualifyingDays: number;
      providerId: ProviderId;
    }
  /** final: false only for "grace", which is not a decision yet. met is set
   *  on a "met" skip: what the pass rule read, so the sweep can show the
   *  player their hit and wait for them to confirm it. */
  | {
      miss: false;
      basis: MissSkipBasis;
      final: boolean;
      met?: { spec: MissSpec; qualifyingDays: number; providerId: ProviderId };
    };

function skip(basis: MissSkipBasis): MissDecision {
  return { miss: false, basis, final: basis !== "grace" };
}

function metSkip(spec: MissSpec, qualifyingDays: number, providerId: ProviderId): MissDecision {
  return { miss: false, basis: "met", final: true, met: { spec, qualifyingDays, providerId } };
}

/**
 * Would the pass path pay this wallet on its CURRENT provider, when that is
 * not the pinned one? True only on a real read that shows the goal met; a
 * provider that is not connected cannot be paid by the pass path either and
 * answers false. Throws when the read fails (the caller records nothing).
 */
async function currentProviderPays(
  deps: MissReadDeps,
  input: { address: Address; pool: MissPool; nowSec: bigint },
  spec: MissSpec,
  pinned: ProviderId,
): Promise<{ providerId: ProviderId; qualifyingDays: number } | null> {
  const current = await deps.storedProviderId(input.address);
  if (current === null || current === pinned || !deps.providerConfigured(current)) {
    return null;
  }
  const provider = deps.providerById(current);
  if (!provider.metrics.includes(spec.metric)) return null;
  if (!(await provider.isConnected(input.address))) return null;
  const { progress } = await runProgress(
    provider,
    input.address,
    spec,
    input.pool.periodStart,
    input.pool.periodEnd,
    new Date(Number(input.nowSec) * 1000),
  );
  return progress.qualifyingDays >= spec.goalDays
    ? { providerId: current, qualifyingDays: progress.qualifyingDays }
    : null;
}

/**
 * The whole rule for one player. Never throws: a provider outage, a store
 * failure or anything else unexpected is a skip, and a skip records nothing.
 */
export async function evaluateMiss(
  deps: MissReadDeps,
  input: {
    pool: MissPool;
    address: Address;
    participant: { joined: boolean; resultRecorded: boolean };
    ledger: readonly LedgerEntry[];
    nowSec: bigint;
    graceSec: number;
  },
): Promise<MissDecision> {
  const pre = missPreconditions(input);
  if (!pre.ok) return skip(pre.basis);
  const spec = pre.spec;

  try {
    // Before any provider call: a wallet that never linked must not cause a
    // provider read, and on Junction a read would create a user.
    const pinned = await deps.pinnedProviderId(input.address, input.pool.periodStart);
    if (pinned === null) return skip("no-stored-provider");
    if (!deps.providerConfigured(pinned)) return skip("provider-unconfigured");
    const provider = deps.providerById(pinned);
    if (!provider.metrics.includes(spec.metric)) return skip("metric-unsupported");
    if (provider.getMissEvidence === undefined) return skip("tz-unknown");

    // The pinned provider is read whether or not it reports connected now:
    // Junction keeps the run's data after a disconnect, and a WHOOP grant
    // that no longer works fails the read below, which records nothing.
    const { evidence, progress } = await runProgress(
      provider,
      input.address,
      spec,
      input.pool.periodStart,
      input.pool.periodEnd,
      new Date(Number(input.nowSec) * 1000),
    );
    if (evidence === null) return skip("tz-unknown");
    const judgement = judgeMissEvidence({
      spec,
      periodStart: input.pool.periodStart,
      periodEnd: input.pool.periodEnd,
      evidence,
    });
    const passMet = progress.qualifyingDays >= spec.goalDays;
    if (!judgement.miss) {
      if (judgement.basis !== "met") return skip(judgement.basis);
      // "met" means SPOTTER waits for this player to confirm, which only
      // makes sense when the pass path would actually pay them. The pass path
      // reads the wallet's current provider; when that is not the pinned
      // one, its own read decides.
      const current = await deps.storedProviderId(input.address);
      if (current !== null && current !== pinned && deps.providerConfigured(current)) {
        const paid = await currentProviderPays(deps, input, spec, pinned);
        return paid !== null
          ? metSkip(spec, paid.qualifyingDays, paid.providerId)
          : skip("met-on-pinned-only");
      }
      return passMet
        ? metSkip(spec, progress.qualifyingDays, pinned)
        : skip("met-by-sessions");
    }
    // Belt and braces: the pass rule over the same read. judgeMissEvidence
    // counts at least as generously, so this only fires if the two drift.
    if (passMet) return metSkip(spec, progress.qualifyingDays, pinned);
    const current = await currentProviderPays(deps, input, spec, pinned);
    if (current !== null) return metSkip(spec, current.qualifyingDays, current.providerId);
    return {
      miss: true,
      spec,
      window: judgement.window,
      qualifyingDays: judgement.qualifyingDays,
      providerId: pinned,
    };
  } catch (err) {
    console.error(
      `[miss] evidence read failed for ${input.address}; recording nothing: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return skip("read-error");
  }
}

/** The pass path's verdict line for a met goal (lib/server/agent/wearable.ts
 *  writes it on a read; the sweep writes the same words when it reads a hit
 *  the player has not opened yet). Counts only, never raw data. */
export function passVerdictReason(
  spec: { threshold: number; unit: string; goalDays: number },
  qualifyingDays: number,
): string {
  return (
    `Your wearable shows ${qualifyingDays} qualifying days ` +
    `(${spec.threshold}+ ${spec.unit}) inside this pool period, ` +
    `meeting the ${spec.goalDays}-day goal.`
  );
}

/** The private receipt's verdict line for a recorded miss: counts only. */
export function missVerdictReason(decision: {
  spec: MissSpec;
  window: string[];
  qualifyingDays: number;
}): string {
  const { spec, window, qualifyingDays } = decision;
  const span =
    window.length === 1 ? window[0] : `${window[0]} to ${window[window.length - 1]}`;
  const unit = SLEEP_METRICS.includes(spec.metric) ? "night" : "day";
  const counted = spec.countsSessions
    ? `${qualifyingDays} of ${spec.goalDays} workouts`
    : `${qualifyingDays} of ${spec.goalDays} qualifying ${unit}s (${spec.threshold}+ ${spec.unit})`;
  return (
    `Your wearable synced every ${unit} of the run (${span}, your time) and shows ` +
    `${counted}. The run is over, so the miss is recorded.`
  );
}
