// Apple Health as a WearableProvider.
//
// HOW THIS ONE IS DIFFERENT, AND WHY THE INTERFACE ALREADY ALLOWS FOR IT
//
// Junction and WHOOP are PULLED: the server asks a vendor API and it answers.
// Apple cannot be pulled by anyone. HealthKit is readable only on the device
// that holds it, there is no cloud API, and there never will be. So Apple is
// PUSHED: the GoHealthMe iPhone app reads HealthKit, aggregates each day on
// device, and posts the daily numbers to /api/wearable/apple/sync. This module
// reads what landed.
//
// Two consequences the other providers do not have:
//
//   1. The link cannot end at a browser consent page, so startLink returns
//      WearableLink kind "app" and hands the user to the phone. The interface
//      already carries that shape.
//   2. There is no credential to check, so isConnected asks whether data has
//      ever arrived. For a pushed provider the first sync IS the evidence that
//      a phone is really attached to this wallet.
//
// WHAT WE DELIBERATELY NEVER RECEIVE
//
// Raw samples. The phone posts one number per day per metric, so heart-rate
// readings, sleep stage timings, workout routes and GPS traces never leave it.
// That is a stronger privacy position than the pulled providers give us: with
// Junction the raw samples sit in a vendor's database, and here they sit only
// on the user's own phone.
//
// A SLEEP SCORE THAT IS NOT A SLEEP SCORE - READ THIS BEFORE TRUSTING A NUMBER
//
// Apple publishes no proprietary 0-100 sleep score, so "sleep_score" here is
// sleep EFFICIENCY: time asleep over time in bed, computed on device from
// HealthKit's sleep stages. That runs 85-95 for an ordinary sleeper, while
// WHOOP's sleep performance percentage is recovery-weighted and routinely
// lower. A pool written as "sleep score 75+" is therefore close to automatic
// for an Apple user and real work for a WHOOP user, on the same stake for the
// same payout.
//
// The vocabulary split has landed, so Apple declares sleep_efficiency and does
// NOT declare sleep_score. That is the honest outcome even though it blocks
// more pools: a pool authored as "sleep score 75+" is now correctly unjoinable
// for an Apple wallet, surfaced before the stake rather than discovered at the
// claim. Two providers silently answering the same threshold with different
// numbers was a money defect, not a wording one.

import {
  appleStoreConfigured,
  deleteAllAppleData,
  getDays,
  getObservedMetrics,
  getSourcedDays,
  hasAnyAppleData,
} from "@/lib/server/wearable/apple-store";
import {
  baselineWeekAverage,
  bestScorePerDay,
  countQualifyingDays,
  daySeries,
} from "@/lib/server/wearable/streak";
import type {
  MetricProgress,
  ObservedCapability,
  WearableLink,
  WearableMetric,
  WearableProgress,
  WearableProvider,
  WearableRecent,
} from "@/lib/server/wearable/types";

/** Whether the Apple path is configured at all. */
export function appleConfigured(): boolean {
  return appleStoreConfigured();
}

/**
 * What the connect surface tells the user, when there is no URL to open.
 *
 * Written to be true on a desktop browser, where a deep link would be useless,
 * and to close the two questions someone reading it will actually have: was I
 * charged, and has anything of mine been read.
 */
const APP_HANDOFF_INSTRUCTIONS =
  "Apple Health can only be read on the device that holds it, so there is " +
  "nothing for this browser to open. Open the GoHealthMe app on your iPhone " +
  "and allow Apple Health when it asks, and your Apple Watch data starts " +
  "syncing to this wallet. Nothing was charged and no health data has been " +
  "read yet.";

/**
 * Where a wallet sits in the Apple link, in the shared vocabulary.
 *
 * "not-linked" nothing has ever arrived from a phone for this wallet
 * "linked"     days have arrived; the watch is reporting
 *
 * Apple never reports "awaiting-first-sync": nothing is created server-side
 * when someone taps Set up, so there is no in-between to be in. Either a phone
 * has pushed or it has not. "metric-unavailable" is decided per goal by
 * daysWithSource, not here.
 */
export type AppleLinkState = "not-linked" | "linked";

export async function appleLinkState(address: string): Promise<AppleLinkState> {
  return (await hasAnyAppleData(address)) ? "linked" : "not-linked";
}

/**
 * Metrics where an unreported day means the person did NOT do the thing, not
 * that the device failed to report.
 *
 * You either did a workout or you did not; a day with no workout row is a real
 * zero. Steps and sleep are the opposite: a missing day means the phone did not
 * sync, and reading it as zero would tell someone who walked 12,000 that they
 * missed. Junction and WHOOP mark every day sourced for these same two, so
 * diverging here would pay differently by provider.
 */
const EVERY_DAY_SOURCED: ReadonlySet<string> = new Set([
  "workouts",
  "distance_km",
]);

/** Every UTC day in an inclusive window. */
function daysInWindow(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * How far back "this device can do that" is answered over.
 *
 * Matches the window the phone collects, so the gate and the verdict are
 * answering the same question. Longer and a retired Watch keeps a capability;
 * much shorter and somebody who simply has not opened the app in a fortnight
 * loses pools they can genuinely satisfy.
 */
const OBSERVED_WINDOW_DAYS = 30;

/** Empty progress, used whenever the wallet has nothing to read yet. */
const NO_PROGRESS: WearableProgress = {
  streakDays: 0,
  baselineWeekAvg: null,
  days: [],
  nightsReported: 0,
};

export const appleProvider: WearableProvider = {
  id: "apple",
  label: "Apple Health",
  readService: "apple-read",
  readLabel: "wearable summary (Apple Health)",
  // Genuinely zero: the read is a query against our own table, not a metered
  // vendor call. Borrowing Junction's estimate would put a charge on the agent
  // receipt that never happens.
  readEstUsd: "0.00",
  // Apple Watch plus iPhone covers the whole vocabulary. Apple is the only one
  // of the three that can verify a steps goal - a WHOOP strap has no pedometer
  // - so shrinking this list makes pools unjoinable for real people.
  // There is no consent page: HealthKit is readable only on the device, so the
  // link ends by handing the user to the phone and nothing here confirms it.
  linkKind: "app",
  metrics: [
    "sleep_efficiency",
    "sleep_hours",
    "steps",
    "active_calories",
    "distance_km",
    "workouts",
  ],

  async startLink(): Promise<WearableLink> {
    // Nothing to provision. The phone posts under the wallet it signs as, so
    // the first sync creates everything that needs creating.
    return {
      kind: "app",
      linkUrl: null,
      instructions: APP_HANDOFF_INSTRUCTIONS,
    };
  },

  isConnected(address: string): Promise<boolean> {
    // For a pushed provider there is no credential to validate, so the honest
    // question is whether a phone has ever reported. Answering "yes" because
    // someone tapped a button would tell a person who never installed the app
    // that their watch is connected, and then read zero days and say they
    // missed the goal.
    return hasAnyAppleData(address);
  },

  /**
   * What THIS wallet's hardware has actually produced.
   *
   * Apple can answer exactly, with no upstream call and no cache staleness,
   * because the phone tells us which metrics it computed. An iPhone with no
   * Apple Watch produces steps and distance and no sleep at all, and this is
   * what lets the join gate say so BEFORE somebody stakes on a sleep pool
   * instead of after.
   *
   * TWO WAYS TO GET THIS WRONG, BOTH OF WHICH TAKE POOLS AWAY FROM SOMEONE:
   *
   * Returning [] when nothing has synced yet. An empty array means "this
   * device produced none of these", which the gate honours by hiding every
   * wearable pool. A wallet that linked ten minutes ago has observed nothing
   * and must fall back to the declared list, so it gets null.
   *
   * Returning [] on a query failure. Narrowing the gate because our own
   * database was unreachable takes pools away for a reason that has nothing
   * to do with the user's device. Errors are null too.
   */
  async observedMetrics(address: string): Promise<ObservedCapability> {
    // The same horizon the phone collects and the verdict reads. Asking a
    // wider question than the payout asks would let a retired device keep a
    // capability it can no longer deliver.
    const since = daysBefore(isoDay(new Date()), OBSERVED_WINDOW_DAYS);

    let observed: string[];
    try {
      observed = await getObservedMetrics(address, since);
    } catch {
      // UNKNOWN, not declared. Our database was unreachable, so we found out
      // nothing. Falling back to the declared list here would hand a wallet
      // every metric Apple can serve on no evidence, which is how a transient
      // outage becomes somebody staking on a goal their phone cannot prove.
      return { kind: "unknown" };
    }

    // DECLARED, not observed-with-an-empty-list. Nothing has arrived yet, so
    // there is nothing to narrow, and an empty observed list would blank the
    // whole board of a wallet that linked ten minutes ago.
    if (observed.length === 0) return { kind: "declared" };

    // Intersect with what this provider declares, so a row written by an older
    // build under a retired metric name cannot widen the gate.
    const declared = new Set<string>(appleProvider.metrics);
    const seen = observed.filter((m) => declared.has(m)) as WearableMetric[];

    // Rows exist but none of them name a metric Apple still serves. That is
    // not "we learned nothing", it is a device whose only recent output is a
    // metric we retired, so declared is the honest answer rather than an empty
    // observed list that would hide every pool.
    if (seen.length === 0) return { kind: "declared" };

    return { kind: "observed", metrics: seen };
  },

  async getMetricProgress(
    address: string,
    metric: WearableMetric,
    threshold: number,
    windowStartISO: string,
    windowEndISO: string,
  ): Promise<MetricProgress> {
    const [rows, sourced] = await Promise.all([
      getDays(address, metric, windowStartISO, windowEndISO),
      getSourcedDays(address, windowStartISO, windowEndISO),
    ]);
    const byDay = bestScorePerDay(
      rows.map((r) => ({ day: r.day, value: r.value })),
    );

    // For a count metric, every day the phone was syncing counts as sourced
    // even where no row exists, because "no workout logged" is an answer and
    // not a gap. Anything else is sourced only on the days that reported.
    const daysWithSource = EVERY_DAY_SOURCED.has(metric)
      ? sourced.size === 0
        ? 0
        : daysInWindow(windowStartISO, windowEndISO).length
      : sourced.size;

    return {
      qualifyingDays: countQualifyingDays(
        byDay,
        threshold,
        0,
        windowStartISO,
        windowEndISO,
      ),
      // Days carrying a value for THIS metric.
      daysWithData: byDay.size,
      // Days the phone reported anything at all. daysWithSource 0 means it has
      // not synced, which waiting fixes. daysWithSource > 0 with daysWithData 0
      // means this device does not measure it, which waiting never fixes, and
      // telling that person to wait is advice that can never come true.
      daysWithSource,
    };
  },

  async getProgress(
    address: string,
    threshold: number,
    goalDays: number,
    windowStartISO?: string,
    windowEndISO?: string,
  ): Promise<WearableProgress> {
    // The dashboard card is a sleep card for every provider. The window is
    // widened backwards so baselineWeekAverage has its 8-14 days to work with.
    const end = windowEndISO ?? isoDay(new Date());
    const start = windowStartISO ?? daysBefore(end, Math.max(goalDays, 14) + 1);
    const rows = await getDays(
      address,
      "sleep_efficiency",
      daysBefore(start, 14),
      end,
    );
    const byDay = bestScorePerDay(
      rows.map((r) => ({ day: r.day, value: r.value })),
    );
    if (byDay.size === 0) return NO_PROGRESS;

    return {
      streakDays: countQualifyingDays(
        byDay,
        threshold,
        goalDays,
        windowStartISO,
        windowEndISO,
      ),
      baselineWeekAvg: baselineWeekAverage(byDay),
      days: daySeries(byDay),
      nightsReported: byDay.size,
    };
  },

  async getRecent(address: string, days: number): Promise<WearableRecent> {
    const end = isoDay(new Date());
    const start = daysBefore(end, Math.max(days, 1));
    const [score, hours, steps] = await Promise.all([
      getDays(address, "sleep_efficiency", start, end),
      getDays(address, "sleep_hours", start, end),
      getDays(address, "steps", start, end),
    ]);

    // Sleep score and sleep hours are separate rows for the same night, so the
    // card needs them merged back into one entry per day.
    const hoursByDay = new Map(hours.map((h) => [h.day, h.value]));
    const scoreByDay = new Map(score.map((s) => [s.day, s.value]));
    const sleepDays = [...new Set([...scoreByDay.keys(), ...hoursByDay.keys()])]
      .sort()
      .reverse();

    return {
      sleep: sleepDays.map((day) => ({
        date: day,
        score: scoreByDay.get(day) ?? null,
        hours: hoursByDay.get(day) ?? null,
      })),
      activity: steps.map((s) => ({ date: s.day, steps: s.value })),
    };
  },

  async disconnect(address: string): Promise<void> {
    // Apple CAN be disconnected, unlike Junction, because the data is ours to
    // delete. Deleting it also makes isConnected answer false again, so the
    // user is not left connected to something they asked us to forget.
    await deleteAllAppleData(address);
  },
};

// --------------------------------------------------------------- date helpers

/** The wearer's local calendar day, matching streak.ts's key format. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBefore(isoDayStr: string, days: number): string {
  const d = new Date(`${isoDayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return isoDay(d);
}
