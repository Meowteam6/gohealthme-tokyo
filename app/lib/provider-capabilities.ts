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

/** The offered goals as one phrase, in LAUNCH_METRICS order. */
export function launchGoalsSentence(): string {
  const labels = LAUNCH_METRICS.map((m) => metricLabel(m));
  if (labels.length <= 1) return labels.join("");
  return `${labels.slice(0, -1).join(", ")} or ${labels[labels.length - 1]}`;
}

export const COMING_LINE = "Coming: heart-zone runs and document proof.";
