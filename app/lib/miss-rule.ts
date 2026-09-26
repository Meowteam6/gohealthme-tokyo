// Which pools can record a miss, in one client-safe place.
//
// The server (lib/server/agent/miss.ts) uses it to decide; the browser uses it
// to tell a player, before the stake and on the run page, whether a miss on
// this run can go to the players who hit or always comes back. The rule for
// the pool itself:
//
//   - commitment model (bountyModel 2), where a recorded miss goes to the
//     players who hit
//   - proven by wearable only
//   - a metric whose day is final once synced (sleep score, sleep efficiency,
//     sleep hours, workouts)
//   - a goal whose text says one count plainly, and SPOTTER's pass reading of
//     it agrees (a misread goal must never forfeit anybody)
//   - created at or after MISS_RULE_FROM_POOL_ID: pools players joined while
//     the app promised "a miss is refunded" keep that promise
//
// Pure: no I/O, safe in a client bundle. next.config.ts inlines
// MISS_RULE_FROM_POOL_ID into the browser so both sides read one cutoff.

import { proofPolicyOf } from "@/lib/contract";
import {
  classifyWearableGoal,
  strictGoalCount,
  type WearableMetric,
  type WearableSpec,
} from "@/lib/wearable-goal";

/** Metrics whose day is final once it has synced, so a shortfall is real.
 *  Steps, calories and distance are left out: a zero there is ambiguous. */
export const MISS_METRICS: readonly WearableMetric[] = [
  "sleep_score",
  "sleep_efficiency",
  "sleep_hours",
  "workouts",
];

export type MissSpec = WearableSpec & {
  metric: WearableMetric;
  /** True when the goal counts sessions ("2 times"): the miss direction then
   *  sums sessions across the run instead of counting days with one. */
  countsSessions: boolean;
};

export type MissPoolBasis =
  | "not-commitment"
  | "not-wearable-only"
  | "metric-not-final"
  | "goal-ambiguous"
  | "before-miss-rule";

let warnedCutoff = false;

/**
 * The first pool id the miss rule applies to (MISS_RULE_FROM_POOL_ID), or null
 * when it is unset or not a positive integer. Null switches the rule off for
 * every pool: nothing is forfeited until an operator names the cutoff, which
 * must be poolCount() + 1 at the moment the commitment copy deploys. Pool ids
 * are per contract, so a redeployed HealthPoolsV3 needs its own value.
 */
export function missRuleFromPoolId(): bigint | null {
  // Literal property access: next.config.ts can only inline a literal.
  const raw = (process.env.MISS_RULE_FROM_POOL_ID ?? "").trim();
  if (!/^\d+$/.test(raw) || BigInt(raw) < 1n) {
    // Loud once on the server (the sweep's logs), silent in the browser: the
    // run pages already say "this run cannot record a miss".
    if (!warnedCutoff && typeof window === "undefined") {
      warnedCutoff = true;
      console.warn(
        raw === ""
          ? "[miss-rule] MISS_RULE_FROM_POOL_ID is unset; no pool records a miss (set it to poolCount()+1 when the commitment copy ships)"
          : `[miss-rule] MISS_RULE_FROM_POOL_ID=${JSON.stringify(raw)} is not a pool id; no pool records a miss`,
      );
    }
    return null;
  }
  return BigInt(raw);
}

type PoolRuleResult = { ok: true; spec: MissSpec } | { ok: false; basis: MissPoolBasis };

/** Everything but the cutoff: what the goal and the pool's model allow. */
function goalRule(pool: { bountyModel: number; goalSpec: string }): PoolRuleResult {
  if (pool.bountyModel !== 2) return { ok: false, basis: "not-commitment" };
  const accepted = proofPolicyOf(pool.goalSpec).accepted;
  if (accepted.length !== 1 || accepted[0] !== "wearable") {
    return { ok: false, basis: "not-wearable-only" };
  }
  const spec = classifyWearableGoal(pool.goalSpec);
  if (spec.metric === null || !MISS_METRICS.includes(spec.metric)) {
    return { ok: false, basis: "metric-not-final" };
  }
  // The count must be said once, plainly, and be the count the pass path
  // reads (classifyWearableGoal): otherwise a player who met the goal as
  // written could be judged against a different number.
  const strict = strictGoalCount(pool.goalSpec);
  if (strict === null || strict.count !== spec.goalDays) {
    return { ok: false, basis: "goal-ambiguous" };
  }
  return {
    ok: true,
    spec: {
      ...spec,
      metric: spec.metric,
      countsSessions: spec.metric === "workouts" && strict.sessions,
    },
  };
}

/** Can this pool ever record a miss? */
export function missRulePool(
  pool: { id: bigint; bountyModel: number; goalSpec: string },
  fromPoolId: bigint | null = missRuleFromPoolId(),
): PoolRuleResult {
  const rule = goalRule(pool);
  if (!rule.ok) return rule;
  if (fromPoolId === null || pool.id < fromPoolId) {
    return { ok: false, basis: "before-miss-rule" };
  }
  return rule;
}

/** Would a pool created now with this goal record misses? For the create
 *  form, which has no pool id yet: every new pool is past the cutoff. */
export function missRuleWouldApply(
  pool: { bountyModel: number; goalSpec: string },
  fromPoolId: bigint | null = missRuleFromPoolId(),
): boolean {
  return fromPoolId !== null && goalRule(pool).ok;
}

/** The rule SPOTTER will run, in one sentence a player reads before staking. */
export function missRuleReading(spec: MissSpec): string {
  if (spec.metric === "workouts") {
    const n = spec.goalDays;
    return spec.countsSessions
      ? `SPOTTER reads this as ${n} ${n === 1 ? "workout" : "workouts"}.`
      : `SPOTTER reads this as ${n} ${n === 1 ? "day" : "days"} with a workout.`;
  }
  const n = spec.goalDays;
  return `SPOTTER reads this as ${n} ${n === 1 ? "night" : "nights"} at ${spec.threshold}+ ${spec.unit}.`;
}
