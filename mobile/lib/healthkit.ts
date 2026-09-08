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
  aggregateSleep,
  SLEEP_ASLEEP_CORE,
  SLEEP_ASLEEP_DEEP,
  SLEEP_ASLEEP_REM,
  SLEEP_ASLEEP_UNSPECIFIED,
  SLEEP_AWAKE,
  SLEEP_IN_BED,
  type DayValue,
  type SleepSample,
} from "./sleep-aggregate";
import { CategoryValueSleepAnalysis } from "@kingstinct/react-native-healthkit";
import {
  isHealthDataAvailable,
  queryWorkoutSamples,
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

export type { DayValue } from "./sleep-aggregate";

interface UnusedDayValue {
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

// COMPILE-TIME CHECK THAT OUR SLEEP CONSTANTS ARE STILL APPLE'S.
//
// sleep-aggregate.ts declares the HKCategoryValueSleepAnalysis values itself so
// it can be tested without the native SDK. That leaves two copies of one fact,
// and a payout depends on them agreeing. The SDK's enum is generated from
// Apple's own headers, so comparing against it here turns a renumbering into a
// build error rather than into every sleep number quietly changing while the
// tests, which encode the same assumption, stay green.
type AssertEqual<A extends B, B> = true;
const _sleepConstantsMatchApple: [
  AssertEqual<typeof SLEEP_IN_BED, CategoryValueSleepAnalysis.inBed>,
  AssertEqual<typeof SLEEP_ASLEEP_UNSPECIFIED, CategoryValueSleepAnalysis.asleepUnspecified>,
  AssertEqual<typeof SLEEP_AWAKE, CategoryValueSleepAnalysis.awake>,
  AssertEqual<typeof SLEEP_ASLEEP_CORE, CategoryValueSleepAnalysis.asleepCore>,
  AssertEqual<typeof SLEEP_ASLEEP_DEEP, CategoryValueSleepAnalysis.asleepDeep>,
  AssertEqual<typeof SLEEP_ASLEEP_REM, CategoryValueSleepAnalysis.asleepREM>,
] = [true, true, true, true, true, true];
void _sleepConstantsMatchApple;

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
/**
 * A gap longer than this ends a night. Two hours is long enough to survive a
 * trip to the bathroom or a stretch the watch simply did not record, and short
 * enough that an afternoon nap is its own event rather than part of last night.
 */
const NIGHT_GAP_MS = 2 * 60 * 60 * 1000;

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

  // HEALTHKIT ALREADY DEDUPLICATES. DO NOT SEPARATE BY SOURCE HERE.
  //
  // An earlier version of this file used the separate-by-source query and took
  // the largest single source per day, on the reasoning that an Apple Watch and
  // an iPhone both counting one walk would otherwise be summed. That reasoning
  // was wrong, and the wrong premise was written into a comment as if it were
  // fact, which is how it would have survived the next review.
  //
  // A statistics query merges overlapping samples from multiple sources by
  // default; `separateBySource` is the flag that TURNS THAT OFF. So the old
  // code disabled Apple's own deduplication and then hand-rolled a worse one:
  // taking the largest source undercounts every day where no single device saw
  // the whole day, and a watch spending an hour on the charger while the phone
  // stays in a pocket is the normal case, not an edge case. That silently paid
  // people less than they walked.
  const rows = await queryStatisticsCollectionForQuantity(
    identifier as never,
    ["cumulativeSum"],
    anchor,
    { day: 1 },
    { unit: unit as never, filter: { date: { startDate: anchor } } },
  );

  const out: DayValue[] = [];
  for (const row of rows) {
    // Already HealthKit's merged value across every source for the day.
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
  const samples = (await queryCategorySamples(
    "HKCategoryTypeIdentifierSleepAnalysis" as never,
    { filter: { date: { startDate: anchor } }, ascending: true } as never,
  )) as unknown as ReadonlyArray<SleepSample>;

  return aggregateSleep(
    samples.map((s) => ({
      value: s.value,
      startDate: s.startDate,
      endDate: s.endDate,
    })),
  );
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
 * Workout sessions per local day.
 *
 * A count metric: a day with no workout means the person did not train, which
 * is a real answer rather than missing data, and the server marks the whole
 * window sourced for exactly that reason.
 */
async function workoutsByDay(since: Date): Promise<DayValue[]> {
  const anchor = localMidnight(since);
  const sessions = (await queryWorkoutSamples({
    filter: { date: { startDate: anchor } },
    ascending: true,
  } as never)) as unknown as ReadonlyArray<{ startDate?: string | Date }>;

  const byDay = new Map<string, number>();
  for (const w of sessions) {
    if (w.startDate === undefined) continue;
    const start = new Date(w.startDate);
    if (Number.isNaN(start.getTime())) continue;
    // Keyed on when the workout STARTED, which is the day the person would say
    // they trained. A run begun at 23:40 belongs to that evening.
    const day = localDay(start);
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return [...byDay].map(([day, value]) => ({ day, value }));
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

  const [steps, distanceKm, activeCalories, sleep, workouts] = await Promise.all([
    dailySums("HKQuantityTypeIdentifierStepCount", "count", since),
    dailySums("HKQuantityTypeIdentifierDistanceWalkingRunning", "m", since, (m) =>
      round(m / 1000, 3),
    ),
    dailySums("HKQuantityTypeIdentifierActiveEnergyBurned", "kcal", since, (k) =>
      round(k, 1),
    ),
    sleepByNight(since),
    workoutsByDay(since),
  ]);

  return [
    { metric: "steps", days: steps },
    { metric: "distance_km", days: distanceKm },
    { metric: "active_calories", days: activeCalories },
    { metric: "sleep_hours", days: sleep.hours },
    { metric: "sleep_efficiency", days: sleep.efficiency },
    // Declared by the provider, so it MUST be collected here. A declared metric
    // the phone never produces makes a workouts pool look joinable and then
    // silently have no data behind it.
    { metric: "workouts", days: workouts },
  ].filter((a) => a.days.length > 0) as Aggregates[];
}
