import { beforeEach, describe, expect, it, vi } from "vitest";

// What one sync sends. The server judges a miss only when the phone covered
// every local day of a challenge, so the body carries the device's timezone
// offset and the list of days the phone read HealthKit for, data or not.
// Field names are a contract with the server; they are asserted literally.
//
// AND WHAT IT REFUSES TO SAY. Coverage is a promise that the phone read every
// metric for those days. A query that threw read nothing, so a sync with any
// unread metric posts its data rows but vouches for no day, and a sync with
// nothing it can honestly say does not post at all.

const mocks = vi.hoisted(() => ({
  collectAggregates: vi.fn(async (_days: number, _now?: Date) => ({
    aggregates: [] as unknown[],
    read: {
      steps: true,
      distance_km: true,
      active_calories: true,
      sleep_hours: true,
      sleep_efficiency: true,
      workouts: true,
    } as Record<string, boolean>,
  })),
  postAggregates: vi.fn(async (_token: string, _body: unknown) => ({ stored: 0, covered: 0 })),
}));

vi.mock("./healthkit", () => ({
  collectAggregates: mocks.collectAggregates,
  METRICS: ["steps", "distance_km", "active_calories", "sleep_hours", "sleep_efficiency", "workouts"],
}));
vi.mock("./api", () => ({
  postAggregates: mocks.postAggregates,
  NotPairedError: class NotPairedError extends Error {},
}));

import {
  HEALTH_UNREADABLE,
  HealthUnreadableError,
  NOTHING_SYNCED,
  PARTIAL_READ,
  syncNotice,
  syncNow,
  type SyncOutcome,
} from "./sync";

/** A collection where every HealthKit query answered, with the given rows. */
function collected(aggregates: unknown[], unread: string[] = []) {
  const read: Record<string, boolean> = {
    steps: true,
    distance_km: true,
    active_calories: true,
    sleep_hours: true,
    sleep_efficiency: true,
    workouts: true,
  };
  for (const m of unread) read[m] = false;
  return { aggregates, read };
}

const ALL_METRICS = [
  "steps",
  "distance_km",
  "active_calories",
  "sleep_hours",
  "sleep_efficiency",
  "workouts",
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("syncNow body", () => {
  it("posts days, tzOffsetSec and coveredDays, with coveredDays spanning the whole window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T09:00:00"));
    mocks.collectAggregates.mockResolvedValueOnce(
      collected([{ metric: "steps", days: [{ day: "2026-10-05", value: 8000 }] }]),
    );
    mocks.postAggregates.mockResolvedValueOnce({ stored: 1, covered: 3 });

    const outcome = await syncNow("token", 2);

    expect(mocks.postAggregates).toHaveBeenCalledTimes(1);
    const [token, body] = mocks.postAggregates.mock.calls[0] as [
      string,
      { days: unknown[]; tzOffsetSec: number; coveredDays: string[] },
    ];
    expect(token).toBe("token");
    expect(body.days).toEqual([{ metric: "steps", day: "2026-10-05", value: 8000 }]);
    expect(body.tzOffsetSec).toBe(-new Date().getTimezoneOffset() * 60);
    // days=2: today and the two days before it. The read margin day
    // (2026-10-03) is read for the sake of 10-04's night but never covered:
    // its own night is cut at midnight and must not be vouched for.
    expect(body.coveredDays).toEqual(["2026-10-04", "2026-10-05", "2026-10-06"]);
    expect(body.coveredDays).not.toContain("2026-10-03");
    expect(Object.keys(body).sort()).toEqual(["coveredDays", "days", "tzOffsetSec"]);

    expect(outcome.sent).toBe(1);
    expect(outcome.daysWithData).toBe(1);
    expect(outcome.coveredDays).toHaveLength(3);
    expect(outcome.unread).toEqual([]);
    expect(outcome.result).toEqual({ stored: 1, covered: 3 });
  });

  it("passes one clock to the collector so the window and the covered days agree", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T09:00:00"));
    mocks.collectAggregates.mockResolvedValueOnce(
      collected([{ metric: "steps", days: [{ day: "2026-10-06", value: 1 }] }]),
    );
    mocks.postAggregates.mockResolvedValueOnce({ stored: 1, covered: 3 });

    await syncNow("token", 2);

    const [days, now] = mocks.collectAggregates.mock.calls[0] as [number, Date];
    expect(days).toBe(2);
    expect(now).toEqual(new Date("2026-10-06T09:00:00"));
  });

  it("never covers a day it does not post rows for", async () => {
    // Whatever collectAggregates returns, the covered list and the rows must
    // agree on the first day; a row outside the covered window would be a
    // day the server judges that the phone never fully read.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T09:00:00"));
    mocks.collectAggregates.mockResolvedValueOnce(
      collected([
        { metric: "steps", days: [{ day: "2026-10-04", value: 1 }, { day: "2026-10-06", value: 2 }] },
      ]),
    );
    mocks.postAggregates.mockResolvedValueOnce({ stored: 2, covered: 3 });

    await syncNow("token", 2);

    const body = mocks.postAggregates.mock.calls[0]?.[1] as {
      days: { day: string }[];
      coveredDays: string[];
    };
    for (const row of body.days) expect(body.coveredDays).toContain(row.day);
  });

  it("carries the sleep stitcher's partial flag on the row, and only when set", async () => {
    mocks.collectAggregates.mockResolvedValueOnce(
      collected([
        {
          metric: "sleep_hours",
          days: [
            { day: "2026-10-05", value: 7.5 },
            { day: "2026-10-06", value: 0.33, partial: true },
          ],
        },
      ]),
    );
    mocks.postAggregates.mockResolvedValueOnce({ stored: 2, covered: 3 });

    await syncNow("token", 2);

    const body = mocks.postAggregates.mock.calls[0]?.[1] as { days: Record<string, unknown>[] };
    expect(body.days[0]).toEqual({ metric: "sleep_hours", day: "2026-10-05", value: 7.5 });
    expect(body.days[1]).toEqual({ metric: "sleep_hours", day: "2026-10-06", value: 0.33, partial: true });
  });

  it("counts distinct days with data across metrics, not rows", async () => {
    mocks.collectAggregates.mockResolvedValueOnce(
      collected([
        { metric: "steps", days: [{ day: "2026-10-05", value: 8000 }, { day: "2026-10-06", value: 100 }] },
        { metric: "workouts", days: [{ day: "2026-10-05", value: 1 }] },
      ]),
    );
    mocks.postAggregates.mockResolvedValueOnce({ stored: 3, covered: 3 });

    const outcome = await syncNow("token", 2);

    expect(outcome.sent).toBe(3);
    expect(outcome.daysWithData).toBe(2);
  });

  it("still posts coverage when every query answered and found nothing, so an empty window counts as covered", async () => {
    // A player who did nothing all week still had their phone read every day.
    // Not telling the server would make that week look unsynced and refund a
    // stake the rules say is lost, which is the WHOOP-parity defect.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T09:00:00"));
    mocks.collectAggregates.mockResolvedValueOnce(collected([]));
    mocks.postAggregates.mockResolvedValueOnce({ stored: 0, covered: 0 });

    const outcome = await syncNow("token", 1);

    expect(mocks.postAggregates).toHaveBeenCalledTimes(1);
    const body = mocks.postAggregates.mock.calls[0]?.[1] as { days: unknown[]; coveredDays: string[] };
    expect(body.days).toEqual([]);
    expect(body.coveredDays).toEqual(["2026-10-05", "2026-10-06"]);
    expect(outcome.sent).toBe(0);
    expect(outcome.daysWithData).toBe(0);
    expect(outcome.unread).toEqual([]);
  });
});

describe("syncNow coverage honesty", () => {
  it("withholds coverage when the workouts query threw, and still posts the steps it read", async () => {
    // THE MONEY BUG THIS PINS. The server records a MISS on a covered day
    // with no workouts row. If the workouts query threw, the phone has no
    // idea whether the person trained, so it must not vouch for the day.
    // The steps it did read are still worth sending.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T09:00:00"));
    mocks.collectAggregates.mockResolvedValueOnce(
      collected([{ metric: "steps", days: [{ day: "2026-10-05", value: 8000 }] }], ["workouts"]),
    );
    mocks.postAggregates.mockResolvedValueOnce({ stored: 1, covered: 0 });

    const outcome = await syncNow("token", 2);

    expect(mocks.postAggregates).toHaveBeenCalledTimes(1);
    const body = mocks.postAggregates.mock.calls[0]?.[1] as {
      days: unknown[];
      tzOffsetSec: number;
      coveredDays: string[];
    };
    expect(body.days).toEqual([{ metric: "steps", day: "2026-10-05", value: 8000 }]);
    expect(body.coveredDays).toEqual([]);
    expect(typeof body.tzOffsetSec).toBe("number");
    expect(outcome.sent).toBe(1);
    expect(outcome.coveredDays).toEqual([]);
    expect(outcome.unread).toEqual(["workouts"]);
    expect(outcome.result).toEqual({ stored: 1, covered: 0 });
  });

  it("withholds coverage on any unread metric, not only the three the sweep reads most", async () => {
    // Apple challenges can be on distance or calories too, so a thrown
    // distance query with claimed coverage would record a miss on a distance
    // day the phone never read.
    for (const metric of ALL_METRICS) {
      vi.clearAllMocks();
      mocks.collectAggregates.mockResolvedValueOnce(
        collected([{ metric: "steps", days: [{ day: "2026-10-05", value: 1 }] }], [metric]),
      );
      mocks.postAggregates.mockResolvedValueOnce({ stored: 1, covered: 0 });

      const outcome = await syncNow("token", 2);

      const body = mocks.postAggregates.mock.calls[0]?.[1] as { coveredDays: string[] };
      expect(body.coveredDays, metric).toEqual([]);
      expect(outcome.unread, metric).toEqual([metric]);
    }
  });

  it("does not post when every query threw, and says so in one plain line", async () => {
    // A locked phone, or Health access denied in a way that throws. There is
    // no row to send and no day to vouch for, and the server refuses an
    // empty batch anyway. Nothing leaves the phone; the screen gets one line
    // and a retry.
    mocks.collectAggregates.mockResolvedValueOnce(collected([], ALL_METRICS));

    const err: unknown = await syncNow("token", 2).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(HealthUnreadableError);
    expect((err as Error).message).toBe(HEALTH_UNREADABLE);
    expect(mocks.postAggregates).not.toHaveBeenCalled();
    expect(HEALTH_UNREADABLE).toBe(
      "Health could not be read. Check Health access in Settings and try again.",
    );
  });

  it("does not post when the queries that answered found nothing and another threw", async () => {
    // Nothing to send and nothing to vouch for: the server would answer 400
    // "days must not be empty", which is not a line a person can act on.
    mocks.collectAggregates.mockResolvedValueOnce(collected([], ["sleep_hours", "sleep_efficiency"]));

    await expect(syncNow("token", 2)).rejects.toThrow(HealthUnreadableError);
    expect(mocks.postAggregates).not.toHaveBeenCalled();
  });
});

describe("syncNotice", () => {
  const outcome = (over: Partial<SyncOutcome>): SyncOutcome => ({
    sent: 1,
    daysWithData: 1,
    coveredDays: ["2026-10-06"],
    unread: [],
    result: { stored: 1, covered: 1 },
    ...over,
  });

  it("says to check Health access when the server stored nothing and covered nothing", () => {
    // The server answers 0/0 to a batch with no data rows: a denied Health
    // sheet (iOS never tells the app), a Watch that has not synced, or a
    // read that broke. A silent "synced" here would be a lie.
    const line = syncNotice(outcome({ sent: 0, daysWithData: 0, result: { stored: 0, covered: 0 } }));
    expect(line).toBe(NOTHING_SYNCED);
    expect(NOTHING_SYNCED).toBe(
      "Nothing synced. Check that GoHealthMe is allowed in Settings > Health > Data Access",
    );
  });

  it("says nothing when the server stored rows", () => {
    expect(syncNotice(outcome({}))).toBeNull();
  });

  it("says coverage was withheld when a metric went unread but rows still landed", () => {
    const line = syncNotice(
      outcome({ unread: ["workouts"], coveredDays: [], result: { stored: 1, covered: 0 } }),
    );
    expect(line).toBe(PARTIAL_READ);
  });

  it("uses plain copy: no run, pool, dare, bet, wager, odds, winner, exclamation marks or em-dashes", () => {
    for (const line of [HEALTH_UNREADABLE, NOTHING_SYNCED, PARTIAL_READ]) {
      expect(line).not.toMatch(/\b(run|pool|dare|bet|wager|odds|winner)\b/i);
      expect(line).not.toMatch(/[!—]/);
    }
  });
});
