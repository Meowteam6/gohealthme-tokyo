// Reading Apple Health on the device, and aggregating it here.
//
// THE ONE RULE THIS FILE EXISTS TO ENFORCE
//
// Raw samples never leave the phone. HealthKit hands us thousands of readings
// a day - every heart-rate measurement, every sleep stage transition, every
// workout's GPS trace. GoHealthMe needs one number per day per metric to decide
// whether a goal was met, so that is the only thing this module produces and
// the only thing lib/sync.ts is able to send.
//
// That is a stronger privacy position than the pulled providers give us. With
// Junction or WHOOP the raw samples sit in a vendor's database. Here they sit
// on the user's own phone and nowhere else, and the server holds six numbers a
// day that say nothing about when you slept or where you ran.
//
// DAYS ARE THE WEARER'S LOCAL CALENDAR DAYS, NOT UTC.
//
// This is the subtle one and it decides payouts. Junction keys a night on the
// device's own calendar_date, so a Sydney wearer who wakes at 08:30 has that
// night on the day they woke up. Keying the same night in UTC would file it on
// the previous day, and the same person doing the same thing would fall in
// different buckets depending on which provider read them - and at a pool
// window's first and last day, that is the difference between being paid and
// not.
//
// So the statistics collection is anchored at LOCAL midnight and every day
// string is formatted in local time. HealthKit does the bucketing itself from
// that anchor, which is also why we do not hand-roll day boundaries.

import {
  isHealthDataAvailable,
  queryCategorySamples,
  queryStatisticsCollectionForQuantity,
  requestAuthorization,
} from "@kingstinct/react-native-healthkit";

/** Mirrors WearableMetric on the server. Names must match exactly. */
export type Metric =
  | "steps"
  | "sleep_hours"
  | "sleep_efficiency"
  | "active_calories"
  | "distance_km"
  | "workouts";

export interface DayValue {
  /** UTC calendar day, YYYY-MM-DD. Same keying the server's streak math uses. */
  day: string;
  value: number;
}

/**
 * Everything we ask HealthKit for, and nothing else.
 *
 * Read-only: the second argument to requestAuthorization is what we would
 * WRITE, and GoHealthMe never writes to anyone's Health app.
 */
const READ_TYPES = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKWorkoutTypeIdentifier",
] as const;

export function healthDataAvailable(): boolean {
  return isHealthDataAvailable();
}

/**
 * Present the HealthKit permission sheet.
 *
 * HONEST CAVEAT: iOS never tells an app what the user actually granted. A
 * resolved promise means the sheet was shown and dismissed, not that anything
 * was allowed. Only data actually arriving proves readability, which is why
 * the screen says so and why isConnected on the server is "data has arrived".
 */
export async function requestPermissions(): Promise<boolean> {
  return requestAuthorization(READ_TYPES as unknown as Parameters<typeof requestAuthorization>[0]);
}

/**
 * Local midnight for a day. The anchor HealthKit buckets from, so every bucket
 * is one of the wearer's own days rather than one of UTC's.
 */
function localMidnight(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * The wearer's local calendar day as YYYY-MM-DD.
 *
 * Deliberately not toISOString().slice(0,10), which converts to UTC first and
 * would shift the day for anyone east of Greenwich after their afternoon, or
 * west of it before their morning.
 */
function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * Daily totals for one cumulative quantity, bucketed by HealthKit.
 *
 * A day HealthKit returns with no sum is omitted rather than sent as zero. The
 * server treats an absent day as "not synced" and a zero as "you did nothing",
 * and those must not be confused on a stake.
 */
async function dailySums(
  identifier: string,
  unit: string,
  since: Date,
  scale: (n: number) => number = (n) => n,
): Promise<DayValue[]> {
  const anchor = localMidnight(since);
  const rows = await queryStatisticsCollectionForQuantity(
    identifier as never,
    ["cumulativeSum"],
    anchor,
    { day: 1 },
    { unit: unit as never, filter: { date: { startDate: anchor } } },
  );

  const out: DayValue[] = [];
  for (const row of rows) {
    const sum = row.sumQuantity?.quantity;
    if (typeof sum !== "number" || !Number.isFinite(sum)) continue;
    const start = row.startDate;
    if (!start) continue;
    out.push({ day: localDay(new Date(start)), value: scale(sum) });
  }
  return out;
}

/**
 * Sleep, aggregated per night into hours asleep and efficiency.
 *
 * HealthKit reports sleep as category samples: stretches of inBed, asleepCore,
 * asleepDeep, asleepREM and awake. Time asleep is the sum of the asleep
 * stages; efficiency is that over time in bed.
 *
 * A night is attributed to the WEARER'S LOCAL day it ENDS on, because a night
 * that starts at 23:40 and one that starts at 00:20 are the same night's sleep
 * to the person living it, and splitting them across two days would halve
 * both. Local rather than UTC so this agrees with how Junction keys the same
 * night; a UTC key would file a Sydney wearer's 08:30 wake-up on the previous
 * day and put the same behaviour in a different bucket per provider.
 *
 * Reported as "sleep_efficiency", NOT "sleep_score". Apple publishes no
 * proprietary 0-100 score, and the two are different measurements: efficiency
 * runs 85-95 for an ordinary sleeper while a WHOOP score is recovery-weighted
 * and lower. Sending efficiency under the name "score" would hold Apple and
 * WHOOP users to different bars on the same pool threshold, silently.
 */
async function sleepByNight(
  since: Date,
): Promise<{ hours: DayValue[]; efficiency: DayValue[] }> {
  const anchor = localMidnight(since);
  const samples = await queryCategorySamples(
    "HKCategoryTypeIdentifierSleepAnalysis" as never,
    { filter: { date: { startDate: anchor } }, ascending: true } as never,
  );

  // HKCategoryValueSleepAnalysis: 0 inBed, 1 asleepUnspecified, 2 awake,
  // 3 asleepCore, 4 asleepDeep, 5 asleepREM.
  const ASLEEP = new Set([1, 3, 4, 5]);
  const IN_BED = 0;

  const asleepMs = new Map<string, number>();
  const inBedMs = new Map<string, number>();

  for (const s of samples as unknown as ReadonlyArray<{
    value: number;
    startDate: string | Date;
    endDate: string | Date;
  }>) {
    const start = new Date(s.startDate).getTime();
    const end = new Date(s.endDate).getTime();
    const ms = end - start;
    if (!Number.isFinite(ms) || ms <= 0) continue;

    const night = localDay(new Date(end));
    if (ASLEEP.has(s.value)) {
      asleepMs.set(night, (asleepMs.get(night) ?? 0) + ms);
    } else if (s.value === IN_BED) {
      inBedMs.set(night, (inBedMs.get(night) ?? 0) + ms);
    }
  }

  const hours: DayValue[] = [];
  const efficiency: DayValue[] = [];

  for (const [night, ms] of asleepMs) {
    hours.push({ day: night, value: round(ms / 3_600_000, 2) });

    // Some devices report only asleep stretches and never inBed. Efficiency
    // against a missing denominator would be a fabricated 100, so the night is
    // simply left without an efficiency value rather than given a flattering
    // one.
    const bed = inBedMs.get(night);
    if (typeof bed === "number" && bed > 0) {
      efficiency.push({
        day: night,
        value: round(Math.min(100, (ms / bed) * 100), 1),
      });
    }
  }

  return { hours, efficiency };
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

export interface Aggregates {
  metric: Metric;
  days: DayValue[];
}

/**
 * Read the last `days` days of Apple Health and return daily aggregates.
 *
 * Everything raw is discarded before this function returns. Nothing that
 * reaches the caller can identify a time of day, a location, or an individual
 * reading.
 */
export async function collectAggregates(days: number): Promise<Aggregates[]> {
  // One extra day of margin. A night whose LOCAL day is the first day of a
  // pool window can end on the previous day in UTC, and anchoring exactly at
  // the boundary drops it. Sending one day more costs a row and closes the
  // hole at the edge of every window.
  const since = new Date();
  since.setDate(since.getDate() - Math.max(1, days) - 1);

  const [steps, distanceKm, activeCalories, sleep] = await Promise.all([
    dailySums("HKQuantityTypeIdentifierStepCount", "count", since),
    dailySums("HKQuantityTypeIdentifierDistanceWalkingRunning", "m", since, (m) =>
      round(m / 1000, 3),
    ),
    dailySums("HKQuantityTypeIdentifierActiveEnergyBurned", "kcal", since, (k) =>
      round(k, 1),
    ),
    sleepByNight(since),
  ]);

  return [
    { metric: "steps", days: steps },
    { metric: "distance_km", days: distanceKm },
    { metric: "active_calories", days: activeCalories },
    { metric: "sleep_hours", days: sleep.hours },
    { metric: "sleep_efficiency", days: sleep.efficiency },
  ].filter((a) => a.days.length > 0) as Aggregates[];
}
