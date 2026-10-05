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
  if (labels.length === 0) return "Counts none of the current challenges yet.";
  const list =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Counts ${list}.`;
}

export function countsLine(provider: ProviderId): string {
  return countsLineFor(PROVIDER_CAPABILITIES[provider]);
}

/**
 * The name a provider goes by on the pairing card and the paired notice. The
 * server labels Apple by what it reads ("Apple Health"); a player pairs a
 * Watch, and the card says so. Every other provider keeps the server's label.
 */
export function providerCardLabel(provider: string, label: string): string {
  return provider === "apple" ? "Apple Watch" : label;
}

/** True when a device has reported a sleep goal at least once. */
export function reportsSleep(metrics: readonly string[]): boolean {
  return metrics.includes("sleep_hours") || metrics.includes("sleep_efficiency");
}

/**
 * What to call a PAIRED device on the notice that says so. Apple is the one
 * provider where the paired thing may be a phone alone: steps come from the
 * iPhone in a pocket, and only a Watch worn to bed sends sleep. Until sleep
 * has arrived the honest name is the iPhone, which is also what the lobby
 * lock calls it ("Your iPhone has no sleep data"); the two must not disagree.
 */
export function pairedDeviceName(
  provider: string,
  label: string,
  metrics: readonly string[],
): string {
  if (provider === "apple" && !reportsSleep(metrics)) return "Your iPhone";
  return providerCardLabel(provider, label);
}
