// The miss rule: when SPOTTER may record verdict=false for a player.
//
// DECISION (Andre, 2026-09-26): V4 runs the commitment model for real. On a
// model-2 pool a recorded miss forfeits the stake to the players who hit, so a
// wrong miss takes somebody's money. The rule is therefore one-sided on
// purpose: SPOTTER records a miss ONLY when every gate below holds, and
// anything short of that records nothing, which settle() turns into a refund
// (HealthPoolsV3 B-2). Never forfeit on absence of data.
//
//   1. the pool is commitment (bountyModel 2), proven by wearable only, and
//      measures a metric whose day is final (sleep score, sleep efficiency,
//      sleep hours, workouts). Steps, calories and distance are skipped: a
//      zero there is ambiguous and a day never closes on its own.
//   2. the run is over and MISS_GRACE_HOURS have passed since periodEnd.
//   3. the player joined, has no result on chain, and SPOTTER has not decided
//      to pay them (a pass waiting on its World ID OK is never overwritten).
//   4. the wallet chose a provider that is still configured, measures this
//      metric, is connected, and can place its data on the wearer's calendar.
//   5. COVERAGE on the wearer's local window W (every local date from
//      periodStart to periodEnd, in the offset of their newest record):
//        sleep     every day in W carries a value > 0 for this metric;
//        workouts  every day in W has a heartbeat (any record at all).
//   6. NOT MET: qualifying days over W are below the goal, AND over W widened
//      by one day on each side (the timezone hedge, always in the player's
//      favour).
//
// The pure core (missRulePool, missPreconditions, judgeMissEvidence) decides;
// evaluateMiss is the I/O shell around it and never throws: any failure is a
// skip, and a skip records nothing.

import type { Address } from "viem";
import type { LedgerEntry } from "@/lib/server/agent/ledger";
import type {
  MissEvidence,
  ProviderId,
  WearableProvider,
} from "@/lib/server/wearable/types";
import type { WearableMetric } from "@/lib/wearable-goal";
import { missRulePool, type MissSpec } from "@/lib/miss-rule";

export { MISS_METRICS, missRulePool, type MissSpec } from "@/lib/miss-rule";

const SLEEP_METRICS: readonly WearableMetric[] = [
  "sleep_score",
  "sleep_efficiency",
  "sleep_hours",
];

/**
 * How long, past periodEnd + grace, settlement of a miss-eligible pool waits
 * for the sweep's miss phase to finish before it settles anyway. A stuck miss
 * phase must never strand the pool: at worst the unjudged are refunded.
 */
export const MISS_PHASE_MAX_S = 2 * 3600;

const DAY_S = 86_400;

export interface MissPool {
  bountyModel: number;
  goalSpec: string;
  settled: boolean;
  cancelled: boolean;
  periodStart: bigint;
  periodEnd: bigint;
}

export type MissSkipBasis =
  | "pool-closed"
  | "not-commitment"
  | "not-wearable-only"
  | "metric-not-final"
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
  | "met"
  | "met-at-boundary"
  | "read-error";

/**
 * When a pool that can record a miss may settle: not before periodEnd + grace
 * (dueAt), and after that only once the miss phase finished it, or once
 * holdUntil passes. Null for every other pool, which keeps its old timing.
 */
export function missSettleWindow(
  pool: { bountyModel: number; goalSpec: string; periodEnd: bigint },
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
  if (spec.goalDays > window.length) {
    return { miss: false, basis: "goal-longer-than-window" };
  }

  if (SLEEP_METRICS.includes(spec.metric)) {
    // daysWithSource is not enough here: an unscored night is a sourced day
    // with no value, and it must not count as a night the player slept short.
    const covered = window.every((day) => (evidence.values[day] ?? 0) > 0);
    if (!covered) return { miss: false, basis: "coverage-gap" };
  } else {
    // A day with no session is a real zero only when the device synced that
    // day at all; the heartbeat on the run's last day is what proves the
    // device reported after the run's final day began.
    const beats = new Set(evidence.heartbeatDays);
    if (!window.every((day) => beats.has(day))) {
      return { miss: false, basis: "coverage-gap" };
    }
  }

  const qualifying = (days: string[]) =>
    days.filter((day) => (evidence.values[day] ?? -Infinity) >= spec.threshold).length;
  const qualifyingDays = qualifying(window);
  if (qualifyingDays >= spec.goalDays) return { miss: false, basis: "met" };
  const widened = [shiftDay(window[0], -1), ...window, shiftDay(window[window.length - 1], 1)];
  if (qualifying(widened) >= spec.goalDays) {
    return { miss: false, basis: "met-at-boundary" };
  }
  return { miss: true, window, qualifyingDays };
}

/** The wearable lookups evaluateMiss needs, injectable for tests. */
export interface MissReadDeps {
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
  /** final: false only for "grace", which is not a decision yet. */
  | { miss: false; basis: MissSkipBasis; final: boolean };

function skip(basis: MissSkipBasis): MissDecision {
  return { miss: false, basis, final: basis !== "grace" };
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
    // provider read, and on Junction isConnected would create a user.
    const stored = await deps.storedProviderId(input.address);
    if (stored === null) return skip("no-stored-provider");
    if (!deps.providerConfigured(stored)) return skip("provider-unconfigured");
    const provider = deps.providerById(stored);
    if (!provider.metrics.includes(spec.metric)) return skip("metric-unsupported");
    if (provider.getMissEvidence === undefined) return skip("tz-unknown");
    if (!(await provider.isConnected(input.address))) return skip("not-connected");

    const evidence = await provider.getMissEvidence(
      input.address,
      spec.metric,
      missEvidenceFromISO(input.pool.periodStart),
    );
    const judgement = judgeMissEvidence({
      spec,
      periodStart: input.pool.periodStart,
      periodEnd: input.pool.periodEnd,
      evidence,
    });
    if (!judgement.miss) return skip(judgement.basis);
    return {
      miss: true,
      spec,
      window: judgement.window,
      qualifyingDays: judgement.qualifyingDays,
      providerId: stored,
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
  return (
    `Your wearable synced every ${unit} of the run (${span}, your time) and shows ` +
    `${qualifyingDays} of ${spec.goalDays} qualifying ${unit}s (${spec.threshold}+ ${spec.unit}). ` +
    "The run is over, so the miss is recorded."
  );
}
