// Junction (Vital) as a WearableProvider.
//
// A thin adapter, deliberately. lib/server/junction.ts is a working, paid
// integration with its own retry policy, timeout budget, user-id memoisation
// and privacy boundary; rewriting it to fit a new interface would risk a live
// path to gain nothing. This file only renames its surface and drops the two
// fields nothing consumed (lastNight and qualified were computed and never
// read - the callers re-derive "met the goal" from streakDays against the
// pool's own goalDays, which is the number the chain agrees with).

import {
  createLinkToken,
  getMetricProgress as junctionGetMetricProgress,
  getProgress as junctionGetProgress,
  getRecent as junctionGetRecent,
  isConnected as junctionIsConnected,
} from "@/lib/server/junction";
import type {
  MetricProgress,
  WearableLink,
  WearableMetric,
  WearableProgress,
  WearableProvider,
  WearableRecent,
} from "@/lib/server/wearable/types";

/** Whether the Junction path is configured at all. */
export function junctionConfigured(): boolean {
  const key = process.env.JUNCTION_API_KEY;
  return key !== undefined && key.trim() !== "";
}

export const junctionProvider: WearableProvider = {
  id: "junction",
  label: "Junction",
  readService: "junction-read",
  readLabel: "wearable summary (Junction)",
  readEstUsd: "0.01",
  // Junction normalises across WHOOP, Oura, Fitbit and Garmin, so it can serve
  // the whole vocabulary. Whether the user's particular device reports a given
  // metric is a separate question, answered by daysWithData rather than here.
  metrics: [
    "sleep_score",
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
    };
  },

  getRecent(address: string, days: number): Promise<WearableRecent> {
    return junctionGetRecent(address, days);
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
