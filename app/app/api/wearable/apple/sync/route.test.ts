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
const setProviderId = vi.fn();
const appleConfigured = vi.fn();
const deviceForToken = vi.fn();
const confirmDevice = vi.fn();

vi.mock("@/lib/server/wearable/apple-store", () => ({
  putDays: (...args: unknown[]) => putDays(...args),
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
    expect(await res.json()).toEqual({ stored: 2, address: ADDRESS });
    // Grouped per metric, because the upsert conflict target is
    // (address, metric, day).
    expect(putDays).toHaveBeenCalledTimes(2);
    expect(putDays).toHaveBeenCalledWith(ADDRESS, "steps", [{ day, value: 9000 }]);
    expect(putDays).toHaveBeenCalledWith(ADDRESS, "sleep_hours", [{ day, value: 7.5 }]);
  });

  it("writes under the address the token was issued for, ignoring any address posted", async () => {
    // An address arriving on a channel the caller controls must never decide
    // whose health data this is. The phone may send one (older builds did);
    // the route acts only on the token's own wallet.
    const stranger = "0x2222222222222222222222222222222222222222";

    const res = await POST(post({ address: stranger, days: ONE_DAY }));

    expect(putDays).toHaveBeenCalledWith(ADDRESS, "steps", expect.anything());
    expect(putDays).not.toHaveBeenCalledWith(stranger, "steps", expect.anything());
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
    expect(await res.json()).toEqual({ stored: 1, address: ADDRESS });
    expect(confirmDevice).not.toHaveBeenCalled();
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
