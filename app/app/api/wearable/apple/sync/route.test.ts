// POST /api/wearable/apple/sync is where Apple Health data enters the system.
// Pinned here:
//
//   - THE SIGNATURE GATE. What lands here decides whether a pool pays. Every
//     wallet address is public - on chain and in this app's own participant
//     lists - so without the signature anyone could post 20,000 steps a day
//     for a stranger and have SPOTTER pay out on it. This is the entire
//     integrity story for a pushed provider, and nothing is written on a 401.
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
const requireAddressSignature = vi.fn();

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
vi.mock("@/lib/server/wallet-auth", () => ({
  requireAddressSignature: (...args: unknown[]) => requireAddressSignature(...args),
}));

import { POST } from "@/app/api/wearable/apple/sync/route";

const ADDRESS = "0x1111111111111111111111111111111111111111";

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function post(body: unknown): Request {
  return new Request("https://app.test/api/wearable/apple/sync", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

const ONE_DAY = [{ metric: "steps", day: yesterday(), value: 9000 }];

beforeEach(() => {
  vi.clearAllMocks();
  appleConfigured.mockReturnValue(true);
  requireAddressSignature.mockResolvedValue({ ok: true, address: ADDRESS });
  putDays.mockImplementation(async (_a: string, _m: string, rows: unknown[]) => rows.length);
  setProviderId.mockResolvedValue(undefined);
});

describe("POST /api/wearable/apple/sync", () => {
  it("rejects an unsigned post with 401 and stores nothing", async () => {
    requireAddressSignature.mockResolvedValue({ ok: false, reason: "missing signature" });

    const res = await POST(post({ address: ADDRESS, days: ONE_DAY }));

    expect(res.status).toBe(401);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("checks the signature against the address in the body", async () => {
    await POST(post({ address: ADDRESS, days: ONE_DAY }));
    expect(requireAddressSignature).toHaveBeenCalledWith(expect.anything(), ADDRESS);
  });

  it("rejects a bad address with 400 before checking anything else", async () => {
    const res = await POST(post({ address: "nope", days: ONE_DAY }));
    expect(res.status).toBe(400);
    expect(requireAddressSignature).not.toHaveBeenCalled();
  });

  it("rejects a day in the future", async () => {
    const soon = new Date();
    soon.setUTCDate(soon.getUTCDate() + 5);
    const res = await POST(
      post({
        address: ADDRESS,
        days: [{ metric: "steps", day: soon.toISOString().slice(0, 10), value: 9000 }],
      }),
    );

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("future") });
    expect(putDays).not.toHaveBeenCalled();
  });

  it("rejects an unknown metric", async () => {
    const res = await POST(
      post({ address: ADDRESS, days: [{ metric: "vibes", day: yesterday(), value: 1 }] }),
    );
    expect(res.status).toBe(400);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("rejects a negative or non-finite value", async () => {
    for (const value of [-1, "9000", null]) {
      const res = await POST(
        post({ address: ADDRESS, days: [{ metric: "steps", day: yesterday(), value }] }),
      );
      expect(res.status).toBe(400);
    }
    expect(putDays).not.toHaveBeenCalled();
  });

  it("rejects a malformed date", async () => {
    for (const day of ["2026-13-01", "01-09-2026", "yesterday"]) {
      const res = await POST(
        post({ address: ADDRESS, days: [{ metric: "steps", day, value: 1 }] }),
      );
      expect(res.status).toBe(400);
    }
    expect(putDays).not.toHaveBeenCalled();
  });

  it("rejects an empty or oversized batch", async () => {
    expect((await POST(post({ address: ADDRESS, days: [] }))).status).toBe(400);

    const huge = Array.from({ length: 401 }, () => ({
      metric: "steps",
      day: yesterday(),
      value: 1,
    }));
    expect((await POST(post({ address: ADDRESS, days: huge }))).status).toBe(400);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("stores nothing when any single entry is invalid", async () => {
    // All-or-nothing: a half-written week is a wrong verdict nobody can see.
    const res = await POST(
      post({
        address: ADDRESS,
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
    const res = await POST(post({ address: ADDRESS, days: ONE_DAY }));
    expect(res.status).toBe(503);
    expect(putDays).not.toHaveBeenCalled();
  });

  it("stores a valid batch and reports how many days landed", async () => {
    const day = yesterday();
    const res = await POST(
      post({
        address: ADDRESS,
        days: [
          { metric: "steps", day, value: 9000 },
          { metric: "sleep_hours", day, value: 7.5 },
        ],
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 2 });
    // Grouped per metric, because the upsert conflict target is
    // (address, metric, day).
    expect(putDays).toHaveBeenCalledTimes(2);
    expect(putDays).toHaveBeenCalledWith(ADDRESS, "steps", [{ day, value: 9000 }]);
    expect(putDays).toHaveBeenCalledWith(ADDRESS, "sleep_hours", [{ day, value: 7.5 }]);
  });

  it("writes under the address RECOVERED from the signature, not the one posted", async () => {
    // The general shape of the bug the WHOOP callback had: an address arriving
    // on a channel the caller controls, trusted because something adjacent to
    // it was verified. Here the signature proves the body address, so the two
    // always agree - but the route must act on the proven value, so that a
    // future edit loosening the comparison cannot silently bind one person's
    // health data to another person's wallet.
    const proven = "0x2222222222222222222222222222222222222222";
    requireAddressSignature.mockResolvedValue({ ok: true, address: proven });

    await POST(post({ address: ADDRESS, days: ONE_DAY }));

    expect(putDays).toHaveBeenCalledWith(proven, "steps", expect.anything());
    expect(putDays).not.toHaveBeenCalledWith(ADDRESS, "steps", expect.anything());
  });

  it("never caches a response about someone's health data", async () => {
    const res = await POST(post({ address: ADDRESS, days: ONE_DAY }));
    expect(res.headers.get("cache-control")).toBe("no-store");
  });

  it("turns a storage failure into a 502 without leaking the cause", async () => {
    putDays.mockRejectedValue(new Error("wearable_days upsert failed: relation missing"));

    const res = await POST(post({ address: ADDRESS, days: ONE_DAY }));

    expect(res.status).toBe(502);
    expect(JSON.stringify(await res.json())).not.toContain("relation missing");
  });
});

describe("recording the provider choice", () => {
  it("records apple only once real data has landed", async () => {
    // This is Apple's callback. The browser tap recorded nothing on purpose:
    // nothing confirms it, and a user who reads the instructions and closes
    // the tab must not lose a provider that was working.
    await POST(post({ address: ADDRESS, days: ONE_DAY }));
    expect(setProviderId).toHaveBeenCalledWith(ADDRESS, "apple");
  });

  it("does not record the choice when nothing was stored", async () => {
    putDays.mockResolvedValue(0);
    await POST(post({ address: ADDRESS, days: ONE_DAY }));
    expect(setProviderId).not.toHaveBeenCalled();
  });

  it("does not record the choice on an unsigned post", async () => {
    requireAddressSignature.mockResolvedValue({ ok: false, reason: "nope" });
    await POST(post({ address: ADDRESS, days: ONE_DAY }));
    expect(setProviderId).not.toHaveBeenCalled();
  });

  it("still reports the sync as stored when recording the choice fails", async () => {
    // The numbers are already saved and the goal does not depend on which
    // provider a dashboard prefers, so a failure here must not fail the sync
    // and make the phone retry data it already delivered.
    setProviderId.mockRejectedValue(new Error("redis down"));

    const res = await POST(post({ address: ADDRESS, days: ONE_DAY }));

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ stored: 1 });
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
        address: ADDRESS,
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
        address: ADDRESS,
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
        address: ADDRESS,
        days: [
          { metric: "steps", day: recent.toISOString().slice(0, 10), value: 9000 },
        ],
      }),
    );

    expect(res.status).toBe(200);
  });
});
