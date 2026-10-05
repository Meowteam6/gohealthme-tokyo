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
// DAYS ARE THE WEARER'S LOCAL CALENDAR DAYS, NOT UTC. See lib/days.ts for why;
// the statistics collection is anchored at LOCAL midnight and every day string
// is formatted in local time. HealthKit does the bucketing itself from that
// anchor, which is also why we do not hand-roll day boundaries.
//
// EVERY CALL HERE IS TYPED AGAINST THE LIBRARY, WITH NO CASTS. Two earlier
// bugs lived behind `as never`: requestAuthorization was handed a bare array
// where { toRead } is required, so the permission sheet never appeared, and
// the sample queries omitted the required `limit`, so they threw and the
// allSettled below dropped sleep and workouts in silence. A cast here is how
// the next one hides; lib/healthkit.test.ts pins the call shapes.

import {
  CategoryValueSleepAnalysis,
  ComparisonPredicateOperator,
  isHealthDataAvailable,
  queryCategorySamples,
  queryStatisticsCollectionForQuantity,
  queryWorkoutSamples,
  requestAuthorization,
  type ObjectTypeIdentifier,
  type PredicateWithMetadataKey,
  type QuantityTypeIdentifier,
  type QueryStatisticsResponse,
  type UnitForIdentifier,
} from "@kingstinct/react-native-healthkit";

import { localDay, localMidnight, reportFrom, windowSince } from "./days";
import {
  aggregateSleep,
  SLEEP_ASLEEP_CORE,
  SLEEP_ASLEEP_DEEP,
  SLEEP_ASLEEP_REM,
  SLEEP_ASLEEP_UNSPECIFIED,
  SLEEP_AWAKE,
  SLEEP_IN_BED,
  type DayValue,
} from "./sleep-aggregate";

/** Mirrors WearableMetric on the server. Names must match exactly. */
export type Metric =
  | "steps"
  | "sleep_hours"
  | "sleep_efficiency"
  | "active_calories"
  | "distance_km"
  | "workouts";

/** Every metric this module produces. One sleep query feeds the two sleep metrics. */
export const METRICS: readonly Metric[] = [
  "steps",
  "distance_km",
  "active_calories",
  "sleep_hours",
  "sleep_efficiency",
  "workouts",
];

export type { DayValue } from "./sleep-aggregate";

/**
 * Everything we ask HealthKit for, and nothing else.
 *
 * Read-only. requestAuthorization also takes a `toShare` list of what we
 * would WRITE, and GoHealthMe never writes to anyone's Health app, so it is
 * never passed.
 */
export const READ_TYPES: readonly ObjectTypeIdentifier[] = [
  "HKQuantityTypeIdentifierStepCount",
  "HKQuantityTypeIdentifierDistanceWalkingRunning",
  "HKQuantityTypeIdentifierActiveEnergyBurned",
  "HKCategoryTypeIdentifierSleepAnalysis",
  "HKWorkoutTypeIdentifier",
];

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

/**
 * Exclude anything a human typed in, on every read.
 *
 * THIS IS THE FRAUD GATE, and without it the whole path is worth nothing.
 * Apple's docs are explicit that "users can always modify their data outside
 * your app": somebody can open the Health app, type 20,000 steps, and any
 * integration that reads the total pays them for it. There is no signature on a
 * HealthKit sample and no way to prove a wrist wore anything.
 *
 * `HKWasUserEntered` is set by whoever wrote the sample, so it is not proof of
 * honesty, but it is what Apple gives us and it stops the trivial case: the
 * Health app sets it on anything typed by hand.
 *
 * NOT `equalTo false`. The flag is YES, NO, or ABSENT, and absent is the
 * overwhelmingly common case for a genuine watch sample. Matching on false
 * would silently exclude almost all real data and leave only the rare sample
 * that explicitly says NO. `notEqualTo true` keeps absent and NO, drops YES.
 */
const NOT_USER_ENTERED: PredicateWithMetadataKey = {
  withMetadataKey: "HKWasUserEntered",
  operatorType: ComparisonPredicateOperator.notEqualTo,
  value: true,
};

/**
 * The library requires a numeric `limit` on every sample query, and documents
 * zero (or any non-positive number) as "all samples". A window of sleep stages
 * or workouts is small; capping it would silently truncate a night.
 */
const NO_LIMIT = 0;

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
  return requestAuthorization({ toRead: READ_TYPES });
}

/**
 * Daily totals for one cumulative quantity, bucketed by HealthKit.
 *
 * A day HealthKit returns with no sum is omitted rather than sent as zero. The
 * server treats an absent day as "not synced" and a zero as "you did nothing",
 * and those must not be confused on a stake.
 */
async function dailySums<T extends QuantityTypeIdentifier>(
  identifier: T,
  unit: UnitForIdentifier<T>,
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
  const rows: readonly QueryStatisticsResponse[] = await queryStatisticsCollectionForQuantity(
    identifier,
    ["cumulativeSum"],
    anchor,
    { day: 1 },
    {
      unit,
      filter: { date: { startDate: anchor }, metadata: NOT_USER_ENTERED },
    },
  );

  const out: DayValue[] = [];
  for (const row of rows) {
    // Already HealthKit's merged value across every source for the day.
    const sum = row.sumQuantity?.quantity;
    if (typeof sum !== "number" || !Number.isFinite(sum)) continue;
    const start = row.startDate;
    if (start === undefined) continue;
    out.push({ day: localDay(new Date(start)), value: scale(sum) });
  }
  return out;
}

/**
 * Sleep, aggregated per night into hours asleep and efficiency.
 *
 * HealthKit reports sleep as category samples: stretches of inBed, asleepCore,
 * asleepDeep, asleepREM and awake. Time asleep is the sum of the asleep
 * stages; efficiency is that over time in bed. The stitching, the day a night
 * belongs to, and the partial flag all live in lib/sleep-aggregate.ts, which
 * is pure so the money arithmetic is tested without a device.
 *
 * Reported as "sleep_efficiency", NOT "sleep_score". Apple publishes no
 * proprietary 0-100 score, and the two are different measurements: efficiency
 * runs 85-95 for an ordinary sleeper while a WHOOP score is recovery-weighted
 * and lower. Sending efficiency under the name "score" would hold Apple and
 * WHOOP users to different bars on the same challenge threshold, silently.
 */
async function sleepByNight(
  since: Date,
  now: Date,
): Promise<{ hours: DayValue[]; efficiency: DayValue[] }> {
  const anchor = localMidnight(since);
  const samples = await queryCategorySamples("HKCategoryTypeIdentifierSleepAnalysis", {
    filter: { date: { startDate: anchor }, metadata: NOT_USER_ENTERED },
    ascending: true,
    limit: NO_LIMIT,
  });

  return aggregateSleep(
    samples.map((s) => ({
      value: s.value,
      startDate: s.startDate,
      endDate: s.endDate,
    })),
    now.getTime(),
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

/** What one read of HealthKit produced, and which metrics it actually read. */
export interface Collection {
  /** Metrics with at least one day of data in the reported window. */
  aggregates: Aggregates[];
  /**
   * Per metric, whether HealthKit answered its query. False means the query
   * threw: the phone learned nothing about those days, not that they were
   * empty, and no caller may vouch for them. A query that answered with no
   * rows is still true: that is a real empty the phone may vouch for.
   */
  read: Record<Metric, boolean>;
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
  const sessions = await queryWorkoutSamples({
    filter: { date: { startDate: anchor }, metadata: NOT_USER_ENTERED },
    ascending: true,
    limit: NO_LIMIT,
  });

  const byDay = new Map<string, number>();
  for (const w of sessions) {
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
 * Read the last `days` days of Apple Health and return daily aggregates for
 * today and the `days` days before it.
 *
 * Everything raw is discarded before this function returns. Nothing that
 * reaches the caller can identify a time of day, a location, or an individual
 * reading. `now` is the clock the window and the partial-night rule use; the
 * caller passes the same instant it used to list the covered days.
 *
 * The read starts one day earlier than the first day returned (days.ts,
 * reportFrom): that margin day's night is cut at its midnight by the query,
 * so reporting it would overwrite a whole night with a shorter one.
 */
export async function collectAggregates(
  days: number,
  now: Date = new Date(),
): Promise<Collection> {
  const since = windowSince(days, now);
  const firstReported = localDay(reportFrom(days, now));

  // allSettled, NOT all. A HealthKit query throws errorDatabaseInaccessible
  // when the device is locked, and Apple documents that as ordinary rather
  // than exceptional. With Promise.all one locked-phone rejection loses all
  // six metrics, so a sync that fires at the wrong moment reports nothing
  // instead of the partial truth it actually had.
  //
  // A failed metric is OMITTED, never sent as zero, AND REPORTED AS UNREAD.
  // An absent day means "not synced" on the server and a zero means "you did
  // not do it", and the whole verdict rests on that distinction. The unread
  // flag carries it one step further: the server records a miss on a day the
  // phone covered with no row, so a rejected query that quietly became an
  // empty result let lib/sync.ts vouch for days it never read. Each metric
  // now says whether HealthKit answered, and coverage is withheld otherwise.
  const settled = await Promise.allSettled([
    dailySums("HKQuantityTypeIdentifierStepCount", "count", since),
    dailySums("HKQuantityTypeIdentifierDistanceWalkingRunning", "m", since, (m) =>
      round(m / 1000, 3),
    ),
    dailySums("HKQuantityTypeIdentifierActiveEnergyBurned", "kcal", since, (k) =>
      round(k, 1),
    ),
    sleepByNight(since, now),
    workoutsByDay(since),
  ]);

  const [stepsR, distanceR, energyR, sleepR, workoutsR] = settled;
  const fulfilled = (r: PromiseSettledResult<unknown> | undefined): boolean =>
    r !== undefined && r.status === "fulfilled";
  const ok = <T,>(r: PromiseSettledResult<T> | undefined, fallback: T): T =>
    r !== undefined && r.status === "fulfilled" ? r.value : fallback;

  const steps = ok(stepsR, [] as DayValue[]);
  const distanceKm = ok(distanceR, [] as DayValue[]);
  const activeCalories = ok(energyR, [] as DayValue[]);
  const sleep = ok(sleepR, { hours: [] as DayValue[], efficiency: [] as DayValue[] });
  const workouts = ok(workoutsR, [] as DayValue[]);

  const read: Record<Metric, boolean> = {
    steps: fulfilled(stepsR),
    distance_km: fulfilled(distanceR),
    active_calories: fulfilled(energyR),
    // One query, two metrics: they are read or unread together.
    sleep_hours: fulfilled(sleepR),
    sleep_efficiency: fulfilled(sleepR),
    workouts: fulfilled(workoutsR),
  };

  const all: Aggregates[] = [
    { metric: "steps", days: steps },
    { metric: "distance_km", days: distanceKm },
    { metric: "active_calories", days: activeCalories },
    { metric: "sleep_hours", days: sleep.hours },
    { metric: "sleep_efficiency", days: sleep.efficiency },
    // Declared by the provider, so it MUST be collected here. A declared metric
    // the phone never produces makes a workouts challenge look joinable and
    // then silently have no data behind it.
    { metric: "workouts", days: workouts },
  ];
  // Day strings are YYYY-MM-DD, so string order is calendar order.
  const aggregates = all
    .map((a) => ({ metric: a.metric, days: a.days.filter((d) => d.day >= firstReported) }))
    .filter((a) => a.days.length > 0);
  return { aggregates, read };
}
