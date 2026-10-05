// POST /api/wearable/apple/sync is where Apple Health data enters the system.
// Pinned here:
//
//   - THE DEVICE-TOKEN GATE. What lands here decides whether a pool pays. Every
//     wallet address is public - on chain and in this app's own participant
//     lists - so without a paired device token anyone could post 20,000 steps
//     a day for a stranger and have SPOTTER pay out on it. Writes go under the
//     address the token was issued for, never one the phone names, and nothing
//     is written on a 401.
//   - THE PROVIDER IS RECORDED ONCE PER PAIRING. A later sync must not flip a
//     player who switched to WHOOP or Junction back to Apple.
//   - NO FUTURE DAYS. Pre-satisfying a pool window that has not happened yet is
//     the cheapest possible forgery. Rejected here and again by a check
//     constraint on the table.
//   - ALL-OR-NOTHING VALIDATION. A partially accepted batch would leave a wallet
//     with some days stored and some silently dropped, and the verdict would be
//     computed from an incomplete week with nobody aware.
//   - only known metrics, only non-negative finite values, only real calendar
//     days, and a bounded batch size.
//   - an unconfigured deployment is a 503, not a retry-forever 500: nothing
//     about waiting fixes a missing service-role key, and the app would queue
//     syncs that can never land.

import { describe, it, expect, vi, beforeEach } from "vitest";

const putDays = vi.fn();
const putCoveredDays = vi.fn();
const setProviderId = vi.fn();
const appleConfigured = vi.fn();
const deviceForToken = vi.fn();
const confirmDevice = vi.fn();

vi.mock("@/lib/server/wearable/apple-store", () => ({
  putDays: (...args: unknown[]) => putDays(...args),
  putCoveredDays: (...args: unknown[]) => putCoveredDays(...args),
}));
vi.mock("@/lib/server/wearable/apple", () => ({
  appleConfigured: () => appleConfigured(),
  appleProvider: {
    metrics: [
      "sleep_efficiency",
      "sleep_hours",
      "steps",
      "active_calories",
      "distance_km",
      "workouts",
    ],
  },
}));
vi.mock("@/lib/server/wearable", () => ({
  setProviderId: (...args: unknown[]) => setProviderId(...args),
}));
vi.mock("@/lib/server/wearable/apple-pairing", () => ({
  deviceForToken: (...args: unknown[]) => deviceForToken(...args),
  confirmDevice: (...args: unknown[]) => confirmDevice(...args),
  readDeviceToken: (req: Request) => {
    const m = /^Bearer\s+(\S+)$/i.exec(req.headers.get("authorization") ?? "");
    return m === null ? null : m[1];
  },
}));

import { POST } from "@/app/api/wearable/apple/sync/route";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

const TOKEN = "t".repeat(43);

function post(body: unknown, token: string | null = TOKEN): Request {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token !== null) headers.authorization = `Bearer ${token}`;
  return new Request("https://app.test/api/wearable/apple/sync", {
    method: "POST",
    headers,
    body: JSON.stringify(body),
  });
}

const ONE_DAY = [{ metric: "steps", day: yesterday(), value: 9000 }];

beforeEach(() => {
  vi.clearAllMocks();
  appleConfigured.mockReturnValue(true);
  deviceForToken.mockResolvedValue({ address: ADDRESS, confirmed: false });
  confirmDevice.mockResolvedValue(undefined);
  putDays.mockImplementation(async (_a: string, _m: string, rows: unknown[]) => rows.length);
  putCoveredDays.mockImplementation(
    async (_a: string, days: string[]) => new Set(days).size,
  );
  setProviderId.mockResolvedValue(undefined);
});

describe("POST /api/wearable/apple/sync", () => {
  it("rejects a post with no device token with 401 and stores nothing", async () => {
    const res = await POST(post({ days: ONE_DAY }, null));
    expect(res.status).toBe(401);
    expect(putDays).not.toHaveBeenCalled();
    expect(deviceForToken).not.toHaveBeenCalled();
  });

  it("rejects an unknown or revoked device token with 401", async () => {
    deviceForToken.mockResolvedValue(null);
    const res = await POST(post({ days: ONE_DAY }));
    expect(res.status).toBe(401);
    expect(deviceForToken).toHaveBeenCalledWith(TOKEN);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("rejects a day in the future", async () => {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 5);
    const res = await POST(
      post({
        days: [{ metric: "steps", day: soon.toISOString().slice(0, 10), value: 9000 }],
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("future") });
    expect(putDays).not.toHaveBeenCalled();
  });

  it("rejects an unknown metric", async () => {
    const res = await POST(
      post({ days: [{ metric: "vibes", day: yesterday(), value: 1 }] }),
    );
    expect(res.status).toBe(400);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("rejects a negative or non-finite value", async () => {
    for (const value of [-1, "9000", null]) {
      const res = await POST(
        post({ days: [{ metric: "steps", day: yesterday(), value }] }),
      );
      expect(res.status).toBe(400);
    }
    expect(putDays).not.toHaveBeenCalled();
  });

  it("rejects a malformed date", async () => {
    for (const day of ["2026-13-01", "01-09-2026", "yesterday"]) {
      const res = await POST(
        post({ days: [{ metric: "steps", day, value: 1 }] }),
      );
      expect(res.status).toBe(400);
    }
    expect(putDays).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized batch", async () => {
    expect((await POST(post({ days: [] }))).status).toBe(400);

    const huge = Array.from({ length: 401 }, () => ({
      metric: "steps",
      day: yesterday(),
      value: 1,
    }));
    expect((await POST(post({ days: huge }))).status).toBe(400);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("stores nothing when any single entry is invalid", async () => {
    // All-or-nothing: a half-written week is a wrong verdict nobody can see.
    const res = await POST(
      post({
        days: [
          { metric: "steps", day: yesterday(), value: 9000 },
          { metric: "steps", day: yesterday(), value: -5 },
        ],
      }),
    );

    expect(res.status).toBe(400);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("reports an unconfigured deployment as 503", async () => {
    appleConfigured.mockReturnValue(false);
    const res = await POST(post({ days: ONE_DAY }));
    expect(res.status).toBe(503);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("stores a valid batch and reports how many days landed", async () => {
    const day = yesterday();
    const res = await POST(
      post({
        days: [
          { metric: "steps", day, value: 9000 },
          { metric: "sleep_hours", day, value: 7.5 },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 2, covered: 1, address: ADDRESS });
    // Grouped per metric, because the upsert conflict target is
    // (address, metric, day).
    expect(putDays).toHaveBeenCalledTimes(2);
    expect(putDays).toHaveBeenCalledWith(ADDRESS, "steps", [{ day, value: 9000 }], null);
    expect(putDays).toHaveBeenCalledWith(ADDRESS, "sleep_hours", [{ day, value: 7.5 }], null);
  });

  it("writes under the address the token was issued for, ignoring any address posted", async () => {
    // An address arriving on a channel the caller controls must never decide
    // whose health data this is. The phone may send one (older builds did);
    // the route acts only on the token's own wallet.
    const stranger = "0x2222222222222222222222222222222222222222";

    const res = await POST(post({ address: stranger, days: ONE_DAY }));

    expect(putDays).toHaveBeenCalledWith(ADDRESS, "steps", expect.anything(), null);
    expect(putDays).not.toHaveBeenCalledWith(stranger, "steps", expect.anything(), null);
    expect(putCoveredDays).toHaveBeenCalledWith(ADDRESS, expect.anything(), null);
    expect((await res.json()).address).toBe(ADDRESS);
  });

  it("never caches a response about someone's health data", async () => {
    const res = await POST(post({ days: ONE_DAY }));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("turns a storage failure into a 502 without leaking the cause", async () => {
    putDays.mockRejectedValue(new Error("wearable_days upsert failed: relation missing"));

    const res = await POST(post({ days: ONE_DAY }));

    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("relation missing");
  });
});

describe("recording the provider choice", () => {
  it("records apple on the first sync after pairing that stores data, and confirms the device", async () => {
    // Apple's callback. Neither the browser tap nor redeeming the code
    // recorded anything: a player who pairs and never syncs keeps a working
    // Junction or WHOOP link.
    await POST(post({ days: ONE_DAY }));
    expect(setProviderId).toHaveBeenCalledWith(ADDRESS, "apple");
    expect(confirmDevice).toHaveBeenCalledWith(TOKEN);
  });

  it("does not record the choice again from a confirmed device", async () => {
    // A player who paired Apple and later picked WHOOP on the web must not be
    // flipped back to Apple by the phone's next background sync.
    deviceForToken.mockResolvedValue({ address: ADDRESS, confirmed: true });
    const res = await POST(post({ days: ONE_DAY }));
    expect(res.status).toBe(200);
    expect(putDays).toHaveBeenCalled();
    expect(setProviderId).not.toHaveBeenCalled();
    expect(confirmDevice).not.toHaveBeenCalled();
  });

  it("does not record the choice when nothing was stored", async () => {
    putDays.mockResolvedValue(0);
    await POST(post({ days: ONE_DAY }));
    expect(setProviderId).not.toHaveBeenCalled();
    expect(confirmDevice).not.toHaveBeenCalled();
  });

  it("does not record the choice without a paired device", async () => {
    deviceForToken.mockResolvedValue(null);
    await POST(post({ days: ONE_DAY }));
    expect(setProviderId).not.toHaveBeenCalled();
  });

  it("still reports the sync as stored when recording the choice fails, and leaves the device unconfirmed", async () => {
    // The numbers are already saved, so a failure here must not fail the sync
    // and make the phone retry data it already delivered. The device stays
    // unconfirmed so the next sync records the choice.
    setProviderId.mockRejectedValue(new Error("redis down"));

    const res = await POST(post({ days: ONE_DAY }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 1, covered: 1, address: ADDRESS });
    expect(confirmDevice).not.toHaveBeenCalled();
  });
});

describe("coverage: which local days the phone read, data or not", () => {
  // This is what lets SPOTTER record an Apple miss the way it records a WHOOP
  // one. A covered day with no workouts row is a real zero; an uncovered day
  // is unknown, and unknown refunds. Without it an Apple player who missed
  // was always refunded while a WHOOP player on the same challenge lost the
  // stake.

  function daysAgo(n: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  }

  it("stores the offset beside every value and the covered days the phone names", async () => {
    const covered = [daysAgo(3), daysAgo(2), daysAgo(1)];
    const res = await POST(
      post({
        days: [{ metric: "workouts", day: daysAgo(2), value: 1 }],
        tzOffsetSec: 9 * 3600,
        coveredDays: covered,
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 1, covered: 3, address: ADDRESS });
    expect(putDays).toHaveBeenCalledWith(
      ADDRESS,
      "workouts",
      [{ day: daysAgo(2), value: 1 }],
      32400,
    );
    expect(putCoveredDays).toHaveBeenCalledWith(ADDRESS, covered, 32400);
  });

  it("forwards a partial flag on a day, and defaults it to false", async () => {
    const res = await POST(
      post({
        days: [
          { metric: "sleep_hours", day: daysAgo(2), value: 7.1 },
          { metric: "sleep_hours", day: daysAgo(1), value: 3.2, partial: true },
        ],
        tzOffsetSec: 0,
        coveredDays: [daysAgo(2), daysAgo(1)],
      }),
    );
    expect(res.status).toBe(200);
    expect(putDays).toHaveBeenCalledWith(
      ADDRESS,
      "sleep_hours",
      [
        { day: daysAgo(2), value: 7.1 },
        { day: daysAgo(1), value: 3.2, partial: true },
      ],
      0,
    );
  });

  it("an older phone that sends neither field still syncs: coverage is the days with data, offset unknown", async () => {
    const res = await POST(
      post({
        days: [
          { metric: "steps", day: daysAgo(2), value: 9000 },
          { metric: "sleep_hours", day: daysAgo(2), value: 7 },
          { metric: "steps", day: daysAgo(1), value: 4000 },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 3, covered: 2, address: ADDRESS });
    expect(putCoveredDays).toHaveBeenCalledWith(ADDRESS, [daysAgo(2), daysAgo(1)], null);
    expect(putDays).toHaveBeenCalledWith(ADDRESS, "steps", expect.anything(), null);
  });

  it("rejects an offset that is not an integer number of seconds on Earth", async () => {
    // (NaN cannot travel through JSON; it arrives as null, which is "unknown".)
    for (const tzOffsetSec of ["32400", 1.5, 15 * 3600, -15 * 3600, {}, true]) {
      const res = await POST(post({ days: ONE_DAY, tzOffsetSec }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/tzOffsetSec/);
    }
    expect(putDays).not.toHaveBeenCalled();
    expect(putCoveredDays).not.toHaveBeenCalled();
  });

  it("accepts the edges of the offset range and a null offset", async () => {
    for (const tzOffsetSec of [14 * 3600, -14 * 3600, 0, null]) {
      expect((await POST(post({ days: ONE_DAY, tzOffsetSec }))).status).toBe(200);
    }
  });

  it("holds covered days to the same date rules as data days", async () => {
    const future = new Date();
    future.setUTCDate(future.getUTCDate() + 5);
    const cases: unknown[] = [
      "not-an-array",
      ["2026-13-01"],
      [future.toISOString().slice(0, 10)],
      [daysAgo(90)],
      [42],
      Array.from({ length: 401 }, () => daysAgo(1)),
    ];
    for (const coveredDays of cases) {
      const res = await POST(post({ days: ONE_DAY, coveredDays }));
      expect(res.status).toBe(400);
      expect((await res.json()).error).toMatch(/coveredDays/);
    }
    // All-or-nothing: nothing was written for any of them.
    expect(putDays).not.toHaveBeenCalled();
    expect(putCoveredDays).not.toHaveBeenCalled();
  });

  it("a batch with no data of any kind records no coverage: a read that found nothing cannot vouch for days it did not read", async () => {
    // The phone reads five HealthKit queries with allSettled and posts the
    // whole window as covered whatever settled. A sync that fires while the
    // phone is locked has every query throw errorDatabaseInaccessible, so it
    // arrives here as days: [] plus thirty-one covered days. Recording that
    // coverage would let SPOTTER read "covered, no workout" on a day whose
    // workout the phone never saw, while an earlier sync's steps rows keep
    // the no-data-at-all guard in getMissEvidence quiet. A carried iPhone
    // produces steps every day, so a batch with no row of any metric is never
    // a real read: answer it, write nothing, and say so in the response.
    const covered = [daysAgo(2), daysAgo(1)];
    const res = await POST(post({ days: [], tzOffsetSec: 3600, coveredDays: covered }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 0, covered: 0, address: ADDRESS });
    expect(putDays).not.toHaveBeenCalled();
    expect(putCoveredDays).not.toHaveBeenCalled();
    expect(setProviderId).not.toHaveBeenCalled();
    expect(confirmDevice).not.toHaveBeenCalled();
  });

  it("coverage is written only when the same batch carries data", async () => {
    const covered = [daysAgo(2), daysAgo(1)];
    const res = await POST(
      post({
        days: [{ metric: "steps", day: daysAgo(1), value: 120 }],
        tzOffsetSec: 3600,
        coveredDays: covered,
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 1, covered: 2, address: ADDRESS });
    expect(putCoveredDays).toHaveBeenCalledWith(ADDRESS, covered, 3600);
  });

  it("rejects a sync that carries neither data nor coverage", async () => {
    expect((await POST(post({ days: [], coveredDays: [] }))).status).toBe(400);
    expect(putCoveredDays).not.toHaveBeenCalled();
  });

  it("rejects a partial flag that is not a boolean", async () => {
    const res = await POST(
      post({ days: [{ metric: "sleep_hours", day: daysAgo(1), value: 7, partial: "yes" }] }),
    );
    expect(res.status).toBe(400);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("writes coverage under the token's wallet after the values, and a coverage failure is a 502", async () => {
    putCoveredDays.mockRejectedValue(new Error("wearable_sync_days upsert failed: relation missing"));
    const res = await POST(post({ days: ONE_DAY, tzOffsetSec: 0, coveredDays: [daysAgo(1)] }));
    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("relation missing");
    // The values landed first and stay: a re-sync upserts them again.
    expect(putDays).toHaveBeenCalled();
  });
});

describe("what the route will not store", () => {
  it("refuses a metric Apple cannot report, even though the app knows it", () => {
    // sleep_score is a real metric that WHOOP serves. Apple publishes no
    // proprietary score, so a row under that name would be data the provider
    // never reads, and observedMetrics would report a capability the join gate
    // would then act on.
    return POST(
      post({
        days: [{ metric: "sleep_score", day: yesterday(), value: 80 }],
      }),
    ).then(async (res) => {
      expect(res.status).toBe(400);
      expect((await res.json()).error).toContain("Apple Health can report");
      expect(putDays).not.toHaveBeenCalled();
    });
  });

  it("refuses a day older than the backfill bound", async () => {
    // Not a security boundary - a signed post is trusted for a pushed provider
    // - but it stops a wallet writing history for a window that closed months
    // ago and is still awaiting settlement.
    const old = new Date();
    old.setUTCDate(old.getUTCDate() - 90);

    const res = await POST(
      post({
        days: [
          { metric: "steps", day: old.toISOString().slice(0, 10), value: 9000 },
        ],
      }),
    );

    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/days old/);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("still accepts a day inside the backfill window", async () => {
    const recent = new Date();
    recent.setUTCDate(recent.getUTCDate() - 20);

    const res = await POST(
      post({
        days: [
          { metric: "steps", day: recent.toISOString().slice(0, 10), value: 9000 },
        ],
      }),
    );

    expect(res.status).toBe(200);
  });
});
