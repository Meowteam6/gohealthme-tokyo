// Which pools can record a miss, in one client-safe place.
//
// The server (lib/server/agent/miss.ts) uses it to decide; the browser uses it
// to tell a player, on the run page, by when their nights must sync. The rule
// for the pool itself: commitment model (bountyModel 2, where a recorded miss
// goes to the players who hit), proven by wearable only, and a metric whose
// day is final once synced. Pure: no I/O, safe in a client bundle.

import { proofPolicyOf } from "@/lib/contract";
import {
  classifyWearableGoal,
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

export type MissSpec = WearableSpec & { metric: WearableMetric };

export type MissPoolBasis = "not-commitment" | "not-wearable-only" | "metric-not-final";

/** Can this pool ever record a miss? */
export function missRulePool(pool: {
  bountyModel: number;
  goalSpec: string;
}): { ok: true; spec: MissSpec } | { ok: false; basis: MissPoolBasis } {
  if (pool.bountyModel !== 2) return { ok: false, basis: "not-commitment" };
  const accepted = proofPolicyOf(pool.goalSpec).accepted;
  if (accepted.length !== 1 || accepted[0] !== "wearable") {
    return { ok: false, basis: "not-wearable-only" };
  }
  const spec = classifyWearableGoal(pool.goalSpec);
  if (spec.metric === null || !MISS_METRICS.includes(spec.metric)) {
    return { ok: false, basis: "metric-not-final" };
  }
  return { ok: true, spec: { ...spec, metric: spec.metric } };
}
