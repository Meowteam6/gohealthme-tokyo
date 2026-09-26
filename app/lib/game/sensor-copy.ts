// One line per wearable on the pairing card: which offered runs it counts.
// Generated from the capability table so it never drifts. Apple's Watch
// caveat stays in the per-device hold, not here. The same wording describes a
// paired device on the character card (countsLineFor), so pairing and the card
// never disagree about what counts.
import type { ProviderId } from "@/lib/wearable-providers";
import { metricLabel, type WearableMetric } from "@/lib/wearable-goal";
import { LAUNCH_METRICS, PROVIDER_CAPABILITIES } from "@/lib/provider-capabilities";

/** The launch goals among `metrics`, in launch order, as words. */
export function launchGoalLabels(metrics: readonly string[]): string[] {
  return LAUNCH_METRICS.filter((m) => metrics.includes(m)).map((m: WearableMetric) =>
    metricLabel(m),
  );
}

/** "Counts X, Y and Z." for a device that reports `metrics`. */
export function countsLineFor(metrics: readonly string[]): string {
  const labels = launchGoalLabels(metrics);
  if (labels.length === 0) return "Counts none of the current runs yet.";
  const list =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Counts ${list}.`;
}

export function countsLine(provider: ProviderId): string {
  return countsLineFor(PROVIDER_CAPABILITIES[provider]);
}
