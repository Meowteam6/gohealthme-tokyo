import { beforeEach, describe, expect, it, vi } from "vitest";

// The two halves of the coverage rule, joined.
//
// lib/sync.test.ts mocks lib/healthkit.ts whole, and lib/healthkit.test.ts
// never calls syncNow, so neither one proves that a HealthKit query which
// THREW ends up as a day the phone refuses to vouch for on the wire. This
// file mocks only the native SDK and the network, and runs the real
// collectAggregates into the real syncNow, so the `read` contract between
// the two files is exercised rather than restated in a mock.

const hk = vi.hoisted(() => ({
  requestAuthorization: vi.fn(async (_: unknown) => true),
  queryCategorySamples: vi.fn(async (_id: unknown, _opts: unknown) => [] as unknown[]),
  queryWorkoutSamples: vi.fn(async (_opts: unknown) => [] as unknown[]),
  queryStatisticsCollectionForQuantity: vi.fn(
    async (..._args: unknown[]) => [] as unknown[],
  ),
  isHealthDataAvailable: vi.fn(() => true),
}));

const net = vi.hoisted(() => ({
  postAggregates: vi.fn(async (_token: string, _body: unknown) => ({ stored: 0, covered: 0 })),
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

vi.mock("./api", () => ({
  postAggregates: net.postAggregates,
  NotPairedError: class NotPairedError extends Error {},
}));

import { HEALTH_UNREADABLE, HealthUnreadableError, NOTHING_SYNCED, syncNotice, syncNow } from "./sync";

type Body = { days: { metric: string; day: string; value: number }[]; tzOffsetSec: number; coveredDays: string[] };

const LOCKED = new Error("errorDatabaseInaccessible");

function stepsOn(day: string, count: number): void {
  hk.queryStatisticsCollectionForQuantity.mockImplementation(async (id: unknown) =>
    id === "HKQuantityTypeIdentifierStepCount"
      ? [{ sumQuantity: { quantity: count, unit: "count" }, startDate: new Date(`${day}T00:00:00`) }]
      : [],
  );
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-06T09:00:00"));
});

describe("coverage across healthkit.ts and sync.ts", () => {
  it("a thrown workouts query reaches the wire as no covered day, while the steps it read still post", async () => {
    hk.queryWorkoutSamples.mockRejectedValueOnce(LOCKED);
    stepsOn("2026-10-05", 8000);
    net.postAggregates.mockResolvedValueOnce({ stored: 1, covered: 0 });

    const outcome = await syncNow("token", 2);

    expect(net.postAggregates).toHaveBeenCalledTimes(1);
    const body = net.postAggregates.mock.calls[0]?.[1] as Body;
    expect(body.days).toEqual([{ metric: "steps", day: "2026-10-05", value: 8000 }]);
    // The key is present and empty, never absent: an absent coveredDays makes
    // the server fall back to the days with data, which would cover 10-05
    // and record a workouts miss on it.
    expect(Object.prototype.hasOwnProperty.call(body, "coveredDays")).toBe(true);
    expect(body.coveredDays).toEqual([]);
    expect(JSON.parse(JSON.stringify(body)).coveredDays).toEqual([]);
    expect(outcome.unread).toEqual(["workouts"]);
  });

  it("a thrown sleep query withholds coverage for both sleep metrics", async () => {
    hk.queryCategorySamples.mockRejectedValueOnce(LOCKED);
    stepsOn("2026-10-06", 10);
    net.postAggregates.mockResolvedValueOnce({ stored: 1, covered: 0 });

    const outcome = await syncNow("token", 2);

    const body = net.postAggregates.mock.calls[0]?.[1] as Body;
    expect(body.coveredDays).toEqual([]);
    expect(outcome.unread.sort()).toEqual(["sleep_efficiency", "sleep_hours"]);
  });

  it("a locked phone (every query throws) never posts, and the screen gets the one line", async () => {
    hk.queryCategorySamples.mockRejectedValueOnce(LOCKED);
    hk.queryWorkoutSamples.mockRejectedValueOnce(LOCKED);
    hk.queryStatisticsCollectionForQuantity
      .mockRejectedValueOnce(LOCKED)
      .mockRejectedValueOnce(LOCKED)
      .mockRejectedValueOnce(LOCKED);

    const err: unknown = await syncNow("token", 2).then(
      () => null,
      (e: unknown) => e,
    );

    expect(err).toBeInstanceOf(HealthUnreadableError);
    expect((err as Error).message).toBe(HEALTH_UNREADABLE);
    expect(net.postAggregates).not.toHaveBeenCalled();
  });

  it("every query answered and empty still posts the window as covered, and the server's 0/0 becomes the Health-access line", async () => {
    // A denied Health sheet: iOS answers every read with nothing and no
    // error. The phone honestly covers the window; the server declines to
    // record coverage on a batch with no data and answers 0/0; the screen
    // turns that into the Settings line instead of a silent success.
    net.postAggregates.mockResolvedValueOnce({ stored: 0, covered: 0 });

    const outcome = await syncNow("token", 2);

    const body = net.postAggregates.mock.calls[0]?.[1] as Body;
    expect(body.days).toEqual([]);
    expect(body.coveredDays).toEqual(["2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(outcome.unread).toEqual([]);
    expect(syncNotice(outcome)).toBe(NOTHING_SYNCED);
  });
});
