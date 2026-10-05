import { beforeEach, describe, expect, it, vi } from "vitest";

// What one sync sends. The server judges a miss only when the phone covered
// every local day of a challenge, so the body carries the device's timezone
// offset and the list of days the phone read HealthKit for, data or not.
// Field names are a contract with the server; they are asserted literally.

const mocks = vi.hoisted(() => ({
  collectAggregates: vi.fn(async (_days: number) => [] as unknown[]),
  postAggregates: vi.fn(async (_token: string, _body: unknown) => ({ stored: 0 })),
}));

vi.mock("./healthkit", () => ({ collectAggregates: mocks.collectAggregates }));
vi.mock("./api", () => ({
  postAggregates: mocks.postAggregates,
  NotPairedError: class NotPairedError extends Error {},
}));

import { syncNow } from "./sync";

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("syncNow body", () => {
  it("posts days, tzOffsetSec and coveredDays, with coveredDays spanning the whole window", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T09:00:00"));
    mocks.collectAggregates.mockResolvedValueOnce([
      { metric: "steps", days: [{ day: "2026-10-05", value: 8000 }] },
    ]);
    mocks.postAggregates.mockResolvedValueOnce({ stored: 1 });

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
    expect(outcome.result.stored).toBe(1);
  });

  it("never covers a day it does not post rows for", async () => {
    // Whatever collectAggregates returns, the covered list and the rows must
    // agree on the first day; a row outside the covered window would be a
    // day the server judges that the phone never fully read.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T09:00:00"));
    mocks.collectAggregates.mockResolvedValueOnce([
      { metric: "steps", days: [{ day: "2026-10-04", value: 1 }, { day: "2026-10-06", value: 2 }] },
    ]);
    mocks.postAggregates.mockResolvedValueOnce({ stored: 2 });

    await syncNow("token", 2);

    const body = mocks.postAggregates.mock.calls[0]?.[1] as {
      days: { day: string }[];
      coveredDays: string[];
    };
    for (const row of body.days) expect(body.coveredDays).toContain(row.day);
  });

  it("carries the sleep stitcher's partial flag on the row, and only when set", async () => {
    mocks.collectAggregates.mockResolvedValueOnce([
      {
        metric: "sleep_hours",
        days: [
          { day: "2026-10-05", value: 7.5 },
          { day: "2026-10-06", value: 0.33, partial: true },
        ],
      },
    ]);
    mocks.postAggregates.mockResolvedValueOnce({ stored: 2 });

    await syncNow("token", 2);

    const body = mocks.postAggregates.mock.calls[0]?.[1] as { days: Record<string, unknown>[] };
    expect(body.days[0]).toEqual({ metric: "sleep_hours", day: "2026-10-05", value: 7.5 });
    expect(body.days[1]).toEqual({ metric: "sleep_hours", day: "2026-10-06", value: 0.33, partial: true });
  });

  it("counts distinct days with data across metrics, not rows", async () => {
    mocks.collectAggregates.mockResolvedValueOnce([
      { metric: "steps", days: [{ day: "2026-10-05", value: 8000 }, { day: "2026-10-06", value: 100 }] },
      { metric: "workouts", days: [{ day: "2026-10-05", value: 1 }] },
    ]);
    mocks.postAggregates.mockResolvedValueOnce({ stored: 3 });

    const outcome = await syncNow("token", 2);

    expect(outcome.sent).toBe(3);
    expect(outcome.daysWithData).toBe(2);
  });

  it("still posts coverage when the phone read nothing, so an empty window counts as covered", async () => {
    // A player who did nothing all week still had their phone read every day.
    // Not telling the server would make that week look unsynced and refund a
    // stake the rules say is lost, which is the WHOOP-parity defect.
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-06T09:00:00"));
    mocks.collectAggregates.mockResolvedValueOnce([]);
    mocks.postAggregates.mockResolvedValueOnce({ stored: 0 });

    const outcome = await syncNow("token", 1);

    expect(mocks.postAggregates).toHaveBeenCalledTimes(1);
    const body = mocks.postAggregates.mock.calls[0]?.[1] as { days: unknown[]; coveredDays: string[] };
    expect(body.days).toEqual([]);
    expect(body.coveredDays).toEqual(["2026-10-05", "2026-10-06"]);
    expect(outcome.sent).toBe(0);
    expect(outcome.daysWithData).toBe(0);
  });
});
