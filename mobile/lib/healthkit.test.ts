import { beforeEach, describe, expect, it, vi } from "vitest";

// THE TWO DEFECTS THIS FILE EXISTS TO PIN
//
// Both were hidden by `as never` casts and verified against the installed
// library types on 2026-10-06. Neither would have shown up before a real
// phone, and on a real phone both are silent.
//
// 1. requestAuthorization takes { toRead: [...] }. Passing the bare array
//    made the native side see no types at all, so the permission sheet never
//    appeared and every later read was empty.
// 2. The sample queries require a numeric `limit` (0 means no limit). Without
//    it the native call throws, and collectAggregates runs under allSettled,
//    so the sleep and workout metrics simply vanished from every sync.
//
// The module is mocked whole: HealthKit does not exist off a phone.

const hk = vi.hoisted(() => ({
  requestAuthorization: vi.fn(async (_: unknown) => true),
  queryCategorySamples: vi.fn(async (_id: unknown, _opts: unknown) => [] as unknown[]),
  queryWorkoutSamples: vi.fn(async (_opts: unknown) => [] as unknown[]),
  queryStatisticsCollectionForQuantity: vi.fn(
    async (..._args: unknown[]) => [] as unknown[],
  ),
  isHealthDataAvailable: vi.fn(() => true),
}));

vi.mock("@kingstinct/react-native-healthkit", () => ({
  ...hk,
  ComparisonPredicateOperator: { notEqualTo: 5 },
  CategoryValueSleepAnalysis: {
    inBed: 0,
    asleepUnspecified: 1,
    awake: 2,
    asleepCore: 3,
    asleepDeep: 4,
    asleepREM: 5,
  },
}));

import { collectAggregates, READ_TYPES, requestPermissions } from "./healthkit";

beforeEach(() => {
  // reset, not clear: several tests install a persistent mockImplementation
  // and clearAllMocks keeps it, so an earlier test's steps leaked into a
  // later "nothing at all" case. reset restores the vi.fn defaults above.
  vi.resetAllMocks();
});

describe("requestPermissions", () => {
  it("asks HealthKit for read access with the { toRead } shape the library requires", async () => {
    await requestPermissions();

    expect(hk.requestAuthorization).toHaveBeenCalledTimes(1);
    const arg = hk.requestAuthorization.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(Array.isArray(arg)).toBe(false);
    expect(arg).toEqual({ toRead: READ_TYPES });
  });

  it("never asks to write: GoHealthMe does not touch anyone's Health app", async () => {
    await requestPermissions();
    const arg = hk.requestAuthorization.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(arg).not.toHaveProperty("toShare");
  });

  it("asks for the five types the metrics need, and nothing else", () => {
    expect([...READ_TYPES].sort()).toEqual(
      [
        "HKQuantityTypeIdentifierStepCount",
        "HKQuantityTypeIdentifierDistanceWalkingRunning",
        "HKQuantityTypeIdentifierActiveEnergyBurned",
        "HKCategoryTypeIdentifierSleepAnalysis",
        "HKWorkoutTypeIdentifier",
      ].sort(),
    );
  });
});

describe("collectAggregates call shapes", () => {
  it("queries sleep samples with a numeric limit", async () => {
    await collectAggregates(7);

    expect(hk.queryCategorySamples).toHaveBeenCalledTimes(1);
    const [identifier, options] = hk.queryCategorySamples.mock.calls[0] as [
      string,
      Record<string, unknown>,
    ];
    expect(identifier).toBe("HKCategoryTypeIdentifierSleepAnalysis");
    expect(typeof options.limit).toBe("number");
    expect(options.ascending).toBe(true);
  });

  it("queries workouts with a numeric limit", async () => {
    await collectAggregates(7);

    expect(hk.queryWorkoutSamples).toHaveBeenCalledTimes(1);
    const [options] = hk.queryWorkoutSamples.mock.calls[0] as [Record<string, unknown>];
    expect(typeof options.limit).toBe("number");
  });

  it("keeps the fraud gate on every read: hand-typed samples are excluded", async () => {
    await collectAggregates(7);

    const expectedMetadata = {
      withMetadataKey: "HKWasUserEntered",
      operatorType: 5,
      value: true,
    };
    const sleepOptions = hk.queryCategorySamples.mock.calls[0]?.[1] as {
      filter?: { metadata?: unknown };
    };
    expect(sleepOptions.filter?.metadata).toEqual(expectedMetadata);

    const workoutOptions = hk.queryWorkoutSamples.mock.calls[0]?.[0] as {
      filter?: { metadata?: unknown };
    };
    expect(workoutOptions.filter?.metadata).toEqual(expectedMetadata);

    for (const call of hk.queryStatisticsCollectionForQuantity.mock.calls) {
      const options = call[4] as { filter?: { metadata?: unknown } };
      expect(options.filter?.metadata).toEqual(expectedMetadata);
    }
  });

  it("buckets the three cumulative quantities by day from local midnight", async () => {
    await collectAggregates(7);

    expect(hk.queryStatisticsCollectionForQuantity).toHaveBeenCalledTimes(3);
    const identifiers = hk.queryStatisticsCollectionForQuantity.mock.calls.map((c) => c[0]);
    expect(identifiers.sort()).toEqual(
      [
        "HKQuantityTypeIdentifierStepCount",
        "HKQuantityTypeIdentifierDistanceWalkingRunning",
        "HKQuantityTypeIdentifierActiveEnergyBurned",
      ].sort(),
    );
    for (const call of hk.queryStatisticsCollectionForQuantity.mock.calls) {
      expect(call[1]).toEqual(["cumulativeSum"]);
      const anchor = call[2] as Date;
      expect(anchor.getHours()).toBe(0);
      expect(anchor.getMinutes()).toBe(0);
      expect(call[3]).toEqual({ day: 1 });
    }
  });

  it("drops a metric whose query throws without losing the others, and reports it unread", async () => {
    // THE MONEY BUG THIS PINS. A rejected query used to become an empty
    // result, indistinguishable from "answered, found nothing". The sync
    // then vouched for the whole window and the server recorded a miss on
    // a workouts day the phone never read. The caller must be able to tell
    // the two apart, so each metric says whether HealthKit answered.
    hk.queryWorkoutSamples.mockRejectedValueOnce(new Error("errorDatabaseInaccessible"));
    hk.queryStatisticsCollectionForQuantity.mockImplementation(async (id: unknown) =>
      id === "HKQuantityTypeIdentifierStepCount"
        ? [{ sumQuantity: { quantity: 4200, unit: "count" }, startDate: new Date("2026-10-05T00:00:00") }]
        : [],
    );

    const { aggregates, read } = await collectAggregates(7);

    expect(aggregates.map((a) => a.metric)).toEqual(["steps"]);
    expect(aggregates[0]?.days).toEqual([{ day: "2026-10-05", value: 4200 }]);
    expect(read.workouts).toBe(false);
    expect(read.steps).toBe(true);
    // Answered and empty is still answered: a real zero the phone may vouch for.
    expect(read.distance_km).toBe(true);
    expect(read.active_calories).toBe(true);
    expect(read.sleep_hours).toBe(true);
    expect(read.sleep_efficiency).toBe(true);
  });

  it("a rejected sleep query marks both sleep metrics unread", async () => {
    hk.queryCategorySamples.mockRejectedValueOnce(new Error("errorDatabaseInaccessible"));

    const { read } = await collectAggregates(7);

    expect(read.sleep_hours).toBe(false);
    expect(read.sleep_efficiency).toBe(false);
    expect(read.steps).toBe(true);
    expect(read.workouts).toBe(true);
  });

  it("every query rejected: nothing aggregated and every metric unread", async () => {
    // A locked phone. HealthKit is sealed behind the passcode and all five
    // queries throw. The phone knows nothing about any day.
    const locked = new Error("errorDatabaseInaccessible");
    hk.queryCategorySamples.mockRejectedValueOnce(locked);
    hk.queryWorkoutSamples.mockRejectedValueOnce(locked);
    // Three cumulative quantities, three queries. Once each, so nothing
    // leaks into the next test.
    hk.queryStatisticsCollectionForQuantity
      .mockRejectedValueOnce(locked)
      .mockRejectedValueOnce(locked)
      .mockRejectedValueOnce(locked);

    const { aggregates, read } = await collectAggregates(7);

    expect(aggregates).toEqual([]);
    expect(Object.values(read).every((v) => v === false)).toBe(true);
    expect(Object.keys(read).sort()).toEqual(
      ["steps", "distance_km", "active_calories", "sleep_hours", "sleep_efficiency", "workouts"].sort(),
    );
  });

  it("every query answered and empty: nothing aggregated, every metric read", async () => {
    const { aggregates, read } = await collectAggregates(7);

    expect(aggregates).toEqual([]);
    expect(Object.values(read).every((v) => v === true)).toBe(true);
  });

  it("reads one margin day before the first reported day, and never reports the margin day", async () => {
    // THE MONEY BUG THIS PINS. The sleep query starts at the window's local
    // midnight with overlap semantics, so a night that ends on that first
    // read day is cut at midnight: 23:00-07:00 reads as 00:00-07:00. If that
    // day were posted, a short background sync would overwrite the full
    // night an earlier 30-day sync stored, and with the day covered, SPOTTER
    // would record a miss on a night the person slept in full. So the first
    // read day is a margin: read so the next day's night is whole, never
    // reported, never covered.
    const now = new Date("2026-10-06T09:00:00");
    hk.queryCategorySamples.mockResolvedValueOnce([
      // Night ending on the margin day (10-03), as HealthKit returns it: the
      // 23:00-00:00 segment of 10-02 is outside the overlap and never comes
      // back, so this reads 7h where the person slept 8.
      { value: 3, startDate: new Date("2026-10-03T00:00:00"), endDate: new Date("2026-10-03T07:00:00") },
      // Night ending on the first reported day (10-04), whole: it began on
      // the margin day, which is why the margin day is read at all.
      { value: 3, startDate: new Date("2026-10-03T23:00:00"), endDate: new Date("2026-10-04T07:00:00") },
    ]);
    hk.queryStatisticsCollectionForQuantity.mockImplementation(async (id: unknown) =>
      id === "HKQuantityTypeIdentifierStepCount"
        ? [
            { sumQuantity: { quantity: 100, unit: "count" }, startDate: new Date("2026-10-03T00:00:00") },
            { sumQuantity: { quantity: 200, unit: "count" }, startDate: new Date("2026-10-04T00:00:00") },
          ]
        : [],
    );

    const { aggregates } = await collectAggregates(2, now);

    // The read itself starts on the margin day.
    const sleepOptions = hk.queryCategorySamples.mock.calls[0]?.[1] as {
      filter?: { date?: { startDate?: Date } };
    };
    expect(sleepOptions.filter?.date?.startDate).toEqual(new Date("2026-10-03T00:00:00"));

    const hours = aggregates.find((a) => a.metric === "sleep_hours");
    expect(hours?.days).toEqual([{ day: "2026-10-04", value: 8 }]);
    const steps = aggregates.find((a) => a.metric === "steps");
    expect(steps?.days).toEqual([{ day: "2026-10-04", value: 200 }]);
    for (const a of aggregates) {
      for (const d of a.days) expect(d.day >= "2026-10-04").toBe(true);
    }
  });

  it("turns sleep samples into hours and efficiency, and flags a partial night", async () => {
    hk.queryCategorySamples.mockResolvedValueOnce([
      // A 20-minute nap and nothing else: hours exist, but the day is partial.
      { value: 0, startDate: new Date("2026-10-04T14:00:00"), endDate: new Date("2026-10-04T14:20:00") },
      { value: 3, startDate: new Date("2026-10-04T14:00:00"), endDate: new Date("2026-10-04T14:20:00") },
    ]);

    const { aggregates } = await collectAggregates(7);

    const hours = aggregates.find((a) => a.metric === "sleep_hours");
    expect(hours?.days).toEqual([{ day: "2026-10-04", value: 0.33, partial: true }]);
  });
});
