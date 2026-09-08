// Junction (Vital) as a WearableProvider.
//
// A thin adapter, deliberately. lib/server/junction.ts is a working, paid
// integration with its own retry policy, timeout budget, user-id memoisation
// and privacy boundary; rewriting it to fit a new interface would risk a live
// path to gain nothing. This file only renames its surface and drops the two
// fields nothing consumed (lastNight and qualified were computed and never
// read - the callers re-derive "met the goal" from streakDays against the
// pool's own goalDays, which is the number the chain agrees with).

import { ttlCache } from "@/lib/server/arc-client";
import {
  createLinkToken,
  getMetricProgress as junctionGetMetricProgress,
  getProgress as junctionGetProgress,
  getRecent as junctionGetRecent,
  isConnected as junctionIsConnected,
} from "@/lib/server/junction";
import type {
  MetricProgress,
  ObservedCapability,
  WearableLink,
  WearableMetric,
  WearableProgress,
  WearableProvider,
  WearableRecent,
} from "@/lib/server/wearable/types";

/**
 * Observed capability is cached per wallet: the probe costs three upstream
 * reads and the answer is a property of somebody's hardware, which does not
 * change between page loads. Short enough that linking a second device shows
 * up the same session; long enough that browsing the pool list is free.
 */
const OBSERVED_TTL_MS = 30 * 60_000;
const observedCache = ttlCache<ObservedCapability>({
  ttlMs: OBSERVED_TTL_MS,
  maxEntries: 512,
});

/** Whether the Junction path is configured at all. */
export function junctionConfigured(): boolean {
  const key = process.env.JUNCTION_API_KEY;
  return key !== undefined && key.trim() !== "";
}

/**
 * How far back the capability probe looks. Long enough that a device syncing
 * every few days still proves itself, short enough that a device somebody
 * stopped wearing does not keep vouching for a metric forever.
 */
const PROBE_DAYS = 14;

/** Probed one call per family; the response covers the metrics beside it. */
const PROBED_METRICS: readonly WearableMetric[] = [
  "sleep_score",
  "sleep_efficiency",
  "sleep_hours",
  "steps",
  "active_calories",
  "workouts",
  "distance_km",
];

export const junctionProvider: WearableProvider = {
  id: "junction",
  label: "Junction",
  readService: "junction-read",
  readLabel: "wearable summary (Junction)",
  readEstUsd: "0.01",
  // Ends at a consent page, so the choice is recorded before the redirect.
  linkKind: "oauth",
  // Junction normalises across WHOOP, Oura, Fitbit and Garmin, so it can serve
  // the whole vocabulary. Whether the user's particular device reports a given
  // metric is a separate question, answered by daysWithData rather than here.
  // Ends at a hosted consent page a browser can open.
  linkKind: "oauth",
  metrics: [
    "sleep_score",
    "sleep_efficiency",
    "sleep_hours",
    "steps",
    "active_calories",
    "distance_km",
    "workouts",
  ],

  async startLink(address: string): Promise<WearableLink> {
    const { linkUrl } = await createLinkToken(address);
    return { kind: "oauth", linkUrl };
  },

  isConnected(address: string): Promise<boolean> {
    return junctionIsConnected(address);
  },

  getMetricProgress(
    address: string,
    metric: WearableMetric,
    threshold: number,
    windowStartISO: string,
    windowEndISO: string,
  ): Promise<MetricProgress> {
    return junctionGetMetricProgress(
      address,
      metric,
      threshold,
      windowStartISO,
      windowEndISO,
    );
  },

  async getProgress(
    address: string,
    threshold: number,
    goalDays: number,
    windowStartISO?: string,
    windowEndISO?: string,
  ): Promise<WearableProgress> {
    const progress = await junctionGetProgress(
      address,
      threshold,
      goalDays,
      windowStartISO,
      windowEndISO,
    );
    return {
      streakDays: progress.streakDays,
      baselineWeekAvg: progress.baselineWeekAvg,
      days: progress.days,
      nightsReported: progress.nightsReported,
    };
  },

  getRecent(address: string, days: number): Promise<WearableRecent> {
    return junctionGetRecent(address, days);
  },

  /**
   * What this wallet's linked device actually reports.
   *
   * Junction fronts several brands and its declared list is the union of what
   * they can do, so a tracker with no proprietary sleep score is still offered
   * sleep-score pools. Probing once per wallet turns that into a refusal at
   * the join instead of a rejection after the stake.
   *
   * Each metric family is probed independently and a failure narrows nothing:
   * an upstream error returns null, which falls back to the declared list, so
   * a Junction hiccup can never take pools off somebody's board.
   */
  async observedMetrics(address: string): Promise<ObservedCapability> {
    try {
      return await observedCache.get(address.toLowerCase(), async () => {
        const today = new Date();
        const from = new Date(today.getTime() - PROBE_DAYS * 86_400_000);
        const start = from.toISOString().slice(0, 10);
        const end = today.toISOString().slice(0, 10);

        // Each probe reports whether it ANSWERED as well as what it found.
        // A probe that threw is not evidence of absence, and treating it as
        // one is how an outage came to look like a device with no sensors.
        const probes = await Promise.all(
          PROBED_METRICS.map(async (metric) => {
            try {
              const progress = await junctionGetMetricProgress(
                address,
                metric,
                // A threshold nothing can meet: we are asking whether the
                // number EXISTS, not whether it was good.
                Number.POSITIVE_INFINITY,
                start,
                end,
              );
              return { answered: true, metric, present: progress.daysWithData > 0 };
            } catch {
              return { answered: false, metric, present: false };
            }
          }),
        );

        // Nothing answered: Junction is refusing us, and we know nothing about
        // this device. Withhold rather than hand back the declared union on no
        // evidence - and throw, so the cache never stores it.
        if (!probes.some((probe) => probe.answered)) {
          throw new Error("no Junction probe answered");
        }

        const observed = probes
          .filter((probe) => probe.present)
          .map((probe) => probe.metric);

        // Answered, and this device has produced nothing in the window. That
        // is a device that has not synced, not one that measures nothing:
        // narrowing to an empty list would take every wearable pool off a new
        // user's board.
        return observed.length === 0
          ? { kind: "declared" }
          : { kind: "observed", metrics: observed };
      });
    } catch {
      // Includes the deliberate throw above, so an all-probes-failed answer is
      // never cached: a cached unknown is an outage that outlives itself.
      return { kind: "unknown" };
    }
  },

  async disconnect(): Promise<void> {
    // Junction owns the link. Unlinking a device is done in Junction's own
    // hosted flow, and deleting our side would leave the two disagreeing:
    // isConnected asks Junction, so it would immediately report connected
    // again. Reported honestly by the route rather than faked here.
    throw new Error(
      "Disconnecting is handled by Junction's own connection page, not by " +
        "GoHealthMe.",
    );
  },
};
