// One line per sensor on the pairing card: which offered runs it counts.
// Generated from the capability table so it never drifts. Apple's Watch
// caveat stays in the per-device hold, not here.
import type { ProviderId } from "@/lib/wearable-providers";
import { metricLabel } from "@/lib/wearable-goal";
import { LAUNCH_METRICS, PROVIDER_CAPABILITIES } from "@/lib/provider-capabilities";

export function countsLine(provider: ProviderId): string {
  const labels = LAUNCH_METRICS.filter((m) => PROVIDER_CAPABILITIES[provider].includes(m)).map((m) =>
    metricLabel(m),
  );
  if (labels.length === 0) return "Counts none of the current runs yet.";
  const list =
    labels.length === 1 ? labels[0] : `${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`;
  return `Counts ${list}.`;
}
