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
