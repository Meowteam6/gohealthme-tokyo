// The metric vocabulary as a runtime value, for validating input from a phone.
//
// lib/wearable-goal.ts owns the WearableMetric TYPE, which vanishes at compile
// time. The Apple sync route has to reject an unknown metric from a device at
// RUNTIME, and a check constraint in the database has to agree with both.
// Keeping the list here as a `satisfies` assertion is what stops those three
// drifting: this file stops compiling the moment the union changes without it.

import type { WearableMetric } from "@/lib/wearable-goal";

export const PROVIDER_METRICS = [
  "sleep_score",
  "sleep_efficiency",
  "sleep_hours",
  "steps",
  "active_calories",
  "distance_km",
  "workouts",
] as const satisfies readonly WearableMetric[];

/** Runtime guard for a metric name arriving from outside the app. */
export function isWearableMetric(value: unknown): value is WearableMetric {
  return (
    typeof value === "string" &&
    (PROVIDER_METRICS as readonly string[]).includes(value)
  );
}
