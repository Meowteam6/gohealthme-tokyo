// Junction (Vital) as a WearableProvider.
//
// A thin adapter, deliberately. lib/server/junction.ts is a working, paid
// integration with its own retry policy, timeout budget, user-id memoisation
// and privacy boundary; rewriting it to fit a new interface would risk a live
// path to gain nothing. This file only renames its surface and drops the two
// fields nothing consumed (lastNight and qualified were computed and never
// read - the callers re-derive "met the goal" from streakDays against the
// pool's own goalDays, which is the number the chain agrees with).

import { PROVIDER_CAPABILITIES } from "@/lib/provider-capabilities";
import { ttlCache } from "@/lib/server/arc-client";
import {
  createLinkToken,
  getMetricProgress as junctionGetMetricProgress,
  getMissEvidence as junctionGetMissEvidence,
  getProgress as junctionGetProgress,
  getRecent as junctionGetRecent,
  isConnected as junctionIsConnected,
} from "@/lib/server/junction";
import type {
  MetricProgress,
  MissEvidence,
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

/**
 * The probe's own short cache. Holds an "awaiting-sync" answer for a few
 * minutes (the long cache refuses it), so a brand-new wallet browsing the
 * lobby is not re-probed seven times per page load.
 */
const PROBE_TTL_MS = 3 * 60_000;
const probeCache = ttlCache<ObservedCapability>({
  ttlMs: PROBE_TTL_MS,
  maxEntries: 512,
});

/** Thrown inside the long cache so an awaiting-sync answer is never held there. */
class AwaitingSync extends Error {
  constructor() {
    super("awaiting first sync");
    this.name = "AwaitingSync";
  }
}

/**
 * The smallest positive threshold. The probe counts a metric as PRESENT only
 * on a day it was above zero: a brand with no pedometer can come back from
 * Junction as `steps: 0` rather than null, and reading that zero as "this
 * device counts steps" is the WHOOP-on-a-steps-run trap all over again. A real
 * pedometer never reports a whole day of zero steps, and a sleep tracker never
 * scores a night it tracked at zero.
 */
const PRESENT_THRESHOLD = Number.MIN_VALUE;

/**
 * Probe every metric family once and reduce the answers to a capability.
 * Throws when no probe answered, so neither cache ever stores that.
 */
async function probeJunction(address: string): Promise<ObservedCapability> {
  const today = new Date();
  const from = new Date(today.getTime() - PROBE_DAYS * 86_400_000);
  const start = from.toISOString().slice(0, 10);
  const end = today.toISOString().slice(0, 10);

  // Each probe reports whether it ANSWERED as well as what it found. A probe
  // that threw is not evidence of absence, and treating it as one is how an
  // outage came to look like a device with no sensors.
  const probes = await Promise.all(
    PROBED_METRICS.map(async (metric) => {
      try {
        const progress = await junctionGetMetricProgress(
          address,
          metric,
          PRESENT_THRESHOLD,
          start,
          end,
        );
        return { answered: true, metric, present: progress.qualifyingDays > 0 };
      } catch {
        return { answered: false, metric, present: false };
      }
    }),
  );

  if (!probes.some((probe) => probe.answered)) {
    throw new Error("no Junction probe answered");
  }

  const observed = probes
    .filter((probe) => probe.present)
    .map((probe) => probe.metric);

  // Answered, and this device has produced nothing in the window. That is a
  // device that has not synced, not one that measures nothing. An empty list
  // would take every wearable pool off the board; the declared union would
  // put runs on it this device can never win. The join waits for the sync.
  if (observed.length === 0) return { kind: "awaiting-sync" };

  // Every brand Junction fronts logs workouts, and a day with no workout is a
  // real zero rather than a missing sensor (the verdict counts it that way).
  // A device syncing anything at all can be judged on workouts even if it
  // logged none in the probe window; leaving it out would refuse a workouts
  // run to somebody who rested for two weeks.
  if (!observed.includes("workouts")) observed.push("workouts");

  return { kind: "observed", metrics: observed };
}

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
  metrics: PROVIDER_CAPABILITIES.junction,

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

  /** The miss rule's read: Junction's calendar_date is already local. */
  getMissEvidence(
    address: string,
    metric: WearableMetric,
    fromISO: string,
  ): Promise<MissEvidence> {
    return junctionGetMissEvidence(address, metric, fromISO);
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
   * sleep-score pools, and a WHOOP strap is offered steps runs. Probing once
   * per wallet turns that into a refusal at the join instead of a rejection
   * after the stake.
   *
   * A device that has synced nothing yet is "awaiting-sync", never the
   * declared union. The union is a statement about brands, not about the
   * strap on this person's wrist, and reading it as the device's capability
   * is how a WHOOP-via-Junction wallet was offered a steps run it cannot win.
   *
   * Each metric family is probed independently. A probe that threw is not
   * evidence of absence; only when NO probe answered is the result "unknown".
   */
  async observedMetrics(address: string): Promise<ObservedCapability> {
    const key = address.toLowerCase();
    try {
      return await observedCache.get(key, async () => {
        // The short probe cache sits under the long one, so a wallet still
        // awaiting its first sync is re-probed every few minutes rather than
        // on every page load, and unlocks within minutes of syncing rather
        // than half an hour later.
        const probed = await probeCache.get(key, () => probeJunction(address));
        if (probed.kind === "awaiting-sync") throw new AwaitingSync();
        return probed;
      });
    } catch (err) {
      if (err instanceof AwaitingSync) return { kind: "awaiting-sync" };
      // Includes the all-probes-failed throw, so an unknown is never cached:
      // a cached unknown is an outage that outlives itself.
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
