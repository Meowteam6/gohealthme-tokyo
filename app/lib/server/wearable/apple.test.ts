import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What is pinned here, and why each one is a money or a truth defect:
//
//   1. isConnected is "data has arrived", not "someone tapped a button".
//      Apple is PUSHED, so there is no credential to validate; the first sync
//      is the only evidence a phone is really attached. Answering yes early
//      would tell someone who never installed the app that their watch is
//      connected, then read zero days and say they missed the goal.
//   2. daysWithData counts days that actually reported. Zero is
//      sync-in-progress, never a miss - the difference between "we cannot tell
//      yet" and "you failed", on a stake.
//   3. A missing day is not a zero. An absent row must not drag a threshold
//      comparison down.
//   4. startLink returns kind "app" with a null URL and provisions nothing.
//      HealthKit cannot be reached from a browser, and a caller that got an
//      oauth shape would open a popup to nowhere.
//   5. Apple declares every metric it can serve. It is the only one of the
//      three that can verify a steps goal, so a shrunken list makes real pools
//      unjoinable.

const from = vi.fn();
const getSupabaseServiceRole = vi.fn();

vi.mock("@/lib/server/supabase", () => ({
  getSupabaseServiceRole: () => getSupabaseServiceRole(),
}));

import { appleConfigured, appleLinkState, appleProvider } from "@/lib/server/wearable/apple";

const ADDRESS = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";

/**
 * A query-builder stub shaped like the fluent chain the store uses. Every
 * filter returns `this`, and the promise resolves with whatever rows the test
 * supplied for that table+metric.
 */
const SOURCE_PROBE_METRICS = [
  "steps",
  "sleep_score",
  "sleep_efficiency",
  "sleep_hours",
  "active_calories",
  "distance_km",
  "workouts",
];

function supabaseWith(rowsFor: (metric: string) => Array<{ day: string; value: number }>) {
  const calls: Array<Record<string, unknown>> = [];

  const builder = () => {
    const state: Record<string, unknown> = {};
    const chain: Record<string, unknown> = {
      select: (cols: string) => {
        state.select = cols;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        state[col] = val;
        return chain;
      },
      // select("metric") with no metric filter is the observed-metrics probe.
      // It must see one row per metric that has data.
      gte: (_c: string, v: unknown) => {
        state.start = v;
        return chain;
      },
      lte: (_c: string, v: unknown) => {
        state.end = v;
        return chain;
      },
      limit: (n: number) => {
        state.limit = n;
        return chain;
      },
      order: () => chain,
      upsert: (rows: unknown, opts: unknown) => {
        state.op = "upsert";
        state.rows = rows;
        state.opts = opts;
        calls.push(state);
        return Promise.resolve({ error: null });
      },
      delete: () => {
        state.op = "delete";
        return chain;
      },
      then: (resolve: (v: unknown) => unknown) => {
        calls.push(state);
        if (state.op === "delete") return resolve({ error: null });

        // select("metric") with no metric filter is the observed-metrics
        // probe: it asks WHICH metrics this wallet has produced, so it must
        // answer with one row per metric that has data.
        if (state.select === "metric") {
          const present = SOURCE_PROBE_METRICS.filter(
            (m) => rowsFor(m).length > 0,
          ).map((metric) => ({ metric }));
          return resolve({ data: present, error: null });
        }

        // A query with no metric filter is the source probe (or the
        // has-any-data probe): it asks which days the device reported
        // ANYTHING on, so it sees every metric's rows.
        const rows =
          state.metric === undefined
            ? SOURCE_PROBE_METRICS.flatMap((m) => rowsFor(m))
            : rowsFor(String(state.metric));

        const limited =
          typeof state.limit === "number" ? rows.slice(0, state.limit) : rows;
        return resolve({ data: limited, error: null });
      },
    };
    return chain;
  };

  from.mockImplementation(() => builder());
  getSupabaseServiceRole.mockReturnValue({ from: (t: string) => from(t) });
  return { calls };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSupabaseServiceRole.mockReturnValue({ from: (t: string) => from(t) });
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("appleConfigured", () => {
  it("is false when Supabase has no service role", () => {
    getSupabaseServiceRole.mockReturnValue(null);
    expect(appleConfigured()).toBe(false);
  });

  it("is true once the service role exists", () => {
    supabaseWith(() => []);
    expect(appleConfigured()).toBe(true);
  });
});

describe("provider metadata", () => {
  it("declares every metric an Apple Watch can serve", () => {
    // Apple is the only provider of the three that can answer a steps pool.
    // A WHOOP strap has no pedometer, so shrinking this list strands pool 14.
    expect(appleProvider.metrics).toEqual([
      "sleep_efficiency",
      "sleep_hours",
      "steps",
      "active_calories",
      "distance_km",
      "workouts",
    ]);
  });

  it("declares a zero read cost because the data is our own table", () => {
    expect(appleProvider.readEstUsd).toBe("0.00");
    expect(appleProvider.readService).toBe("apple-read");
  });
});

describe("startLink", () => {
  it("returns an app handoff with no URL and provisions nothing", async () => {
    supabaseWith(() => []);
    const link = await appleProvider.startLink(ADDRESS);

    expect(link.kind).toBe("app");
    if (link.kind !== "app") throw new Error("expected app link");
    expect(link.linkUrl).toBeNull();
    // Must read correctly on a desktop, where a deep link is useless, and
    // answer "was I charged".
    expect(link.instructions).toContain("iPhone");
    expect(link.instructions).toMatch(/nothing was charged/i);
    // Nothing is created server-side by tapping Set up.
    expect(from).not.toHaveBeenCalled();
  });
});

describe("isConnected", () => {
  it("is false when nothing has ever been pushed", async () => {
    supabaseWith(() => []);
    expect(await appleProvider.isConnected(ADDRESS)).toBe(false);
  });

  it("is true once any Apple day exists", async () => {
    supabaseWith(() => [{ day: "2026-09-01", value: 9000 }]);
    expect(await appleProvider.isConnected(ADDRESS)).toBe(true);
  });

  it("lowercases the address, since that is how rows are keyed", async () => {
    const { calls } = supabaseWith(() => []);
    await appleProvider.isConnected(ADDRESS);
    expect(calls[0].address).toBe(ADDRESS.toLowerCase());
  });
});

describe("appleLinkState", () => {
  it("is not-linked before the first sync and linked after it", async () => {
    supabaseWith(() => []);
    expect(await appleLinkState(ADDRESS)).toBe("not-linked");

    supabaseWith(() => [{ day: "2026-09-01", value: 1 }]);
    expect(await appleLinkState(ADDRESS)).toBe("linked");
  });
});

describe("getMetricProgress", () => {
  it("counts qualifying days for a steps goal", async () => {
    supabaseWith((metric) =>
      metric === "steps"
        ? [
            { day: "2026-09-01", value: 9000 },
            { day: "2026-09-02", value: 7000 },
            { day: "2026-09-03", value: 12000 },
          ]
        : [],
    );

    const progress = await appleProvider.getMetricProgress(
      ADDRESS,
      "steps",
      8000,
      "2026-09-01",
      "2026-09-03",
    );

    expect(progress).toEqual({
      qualifyingDays: 2,
      daysWithData: 3,
      daysWithSource: 3,
    });
  });

  it("separates no-data from missed-goal", async () => {
    // daysWithData 0 must mean "the watch has not synced", which the verdict
    // treats as in-progress. Reading it as a miss refuses to pay someone who
    // did the work and simply has not synced.
    supabaseWith(() => []);

    const progress = await appleProvider.getMetricProgress(
      ADDRESS,
      "steps",
      8000,
      "2026-09-01",
      "2026-09-03",
    );

    expect(progress).toEqual({
      qualifyingDays: 0,
      daysWithData: 0,
      daysWithSource: 0,
    });
  });

  it("treats an absent day as absent, not as a zero", async () => {
    supabaseWith((metric) =>
      metric === "steps" ? [{ day: "2026-09-02", value: 9000 }] : [],
    );

    const progress = await appleProvider.getMetricProgress(
      ADDRESS,
      "steps",
      8000,
      "2026-09-01",
      "2026-09-03",
    );

    expect(progress.qualifyingDays).toBe(1);
    expect(progress.daysWithData).toBe(1);
  });

  it("queries the metric it was asked for", async () => {
    const { calls } = supabaseWith(() => []);
    await appleProvider.getMetricProgress(
      ADDRESS,
      "sleep_hours",
      7,
      "2026-09-01",
      "2026-09-07",
    );
    expect(calls[0].metric).toBe("sleep_hours");
  });
});

describe("getRecent", () => {
  it("merges sleep score and sleep hours into one row per night", async () => {
    supabaseWith((metric) => {
      if (metric === "sleep_efficiency") return [{ day: "2026-09-01", value: 91 }];
      if (metric === "sleep_hours") return [{ day: "2026-09-01", value: 7 }];
      if (metric === "steps") return [{ day: "2026-09-01", value: 8800 }];
      return [];
    });

    const recent = await appleProvider.getRecent(ADDRESS, 7);

    expect(recent.sleep).toEqual([{ date: "2026-09-01", score: 91, hours: 7 }]);
    expect(recent.activity).toEqual([{ date: "2026-09-01", steps: 8800 }]);
  });

  it("keeps a night that has hours but no score", async () => {
    supabaseWith((metric) =>
      metric === "sleep_hours" ? [{ day: "2026-09-02", value: 6.5 }] : [],
    );

    const recent = await appleProvider.getRecent(ADDRESS, 7);

    expect(recent.sleep).toEqual([
      { date: "2026-09-02", score: null, hours: 6.5 },
    ]);
  });
});

describe("disconnect", () => {
  it("deletes this wallet's Apple data", async () => {
    // Apple can genuinely disconnect, unlike Junction, because the data is
    // ours. Leaving it would keep isConnected answering true after someone
    // asked us to forget them.
    const { calls } = supabaseWith(() => []);

    await appleProvider.disconnect(ADDRESS);

    const del = calls.find((c) => c.op === "delete");
    expect(del).toBeDefined();
    expect(del?.address).toBe(ADDRESS.toLowerCase());
    expect(del?.source).toBe("apple");
  });

  it("is a no-op when Supabase is not configured", async () => {
    getSupabaseServiceRole.mockReturnValue(null);
    await expect(appleProvider.disconnect(ADDRESS)).resolves.toBeUndefined();
  });
});

describe("daysWithSource, the field that stops impossible advice", () => {
  it("counts a synced day even when this metric has no value on it", async () => {
    // The defect this pins: a phone that syncs steps faithfully but produces
    // no sleep efficiency has days sourced and zero days of sleep data. Without
    // daysWithSource the verdict reads that as "still syncing, give it a few
    // minutes", which is advice that can never come true.
    supabaseWith((metric) =>
      metric === "steps" ? [{ day: "2026-09-01", value: 9000 }] : [],
    );

    const progress = await appleProvider.getMetricProgress(
      ADDRESS,
      "sleep_efficiency",
      75,
      "2026-09-01",
      "2026-09-01",
    );

    expect(progress.daysWithData).toBe(0);
    expect(progress.daysWithSource).toBeGreaterThan(0);
  });

  it("marks every day sourced for a count metric once the phone is syncing", async () => {
    // A day with no workout logged means you did not train. Reporting it as
    // unsourced would tell someone who skipped the gym that their phone is
    // still syncing.
    supabaseWith((metric) =>
      metric === "steps" ? [{ day: "2026-09-01", value: 9000 }] : [],
    );

    const progress = await appleProvider.getMetricProgress(
      ADDRESS,
      "workouts",
      1,
      "2026-09-01",
      "2026-09-07",
    );

    expect(progress.daysWithData).toBe(0);
    expect(progress.daysWithSource).toBe(7);
  });

  it("reports zero sourced days for a count metric when nothing has synced", async () => {
    supabaseWith(() => []);

    const progress = await appleProvider.getMetricProgress(
      ADDRESS,
      "workouts",
      1,
      "2026-09-01",
      "2026-09-07",
    );

    expect(progress.daysWithSource).toBe(0);
  });
});

describe("getProgress", () => {
  it("reports nightsReported alongside the streak", async () => {
    supabaseWith((metric) =>
      metric === "sleep_efficiency"
        ? [
            { day: "2026-09-01", value: 91 },
            { day: "2026-09-02", value: 70 },
          ]
        : [],
    );

    const progress = await appleProvider.getProgress(
      ADDRESS,
      75,
      7,
      "2026-09-01",
      "2026-09-07",
    );

    expect(progress.nightsReported).toBe(2);
    expect(progress.streakDays).toBe(1);
  });

  it("returns zero nights reported when nothing has synced", async () => {
    supabaseWith(() => []);
    const progress = await appleProvider.getProgress(ADDRESS, 75, 7);
    expect(progress.nightsReported).toBe(0);
    expect(progress.streakDays).toBe(0);
  });
});

describe("observedMetrics, the join gate's device truth", () => {
  it("returns only what this wallet's hardware actually produced", async () => {
    // The case this exists for: an iPhone with no Apple Watch. Steps and
    // distance arrive, sleep never does. The gate must know that BEFORE the
    // person stakes on a sleep pool.
    supabaseWith((metric) =>
      metric === "steps" || metric === "distance_km"
        ? [{ day: "2026-09-01", value: 9000 }]
        : [],
    );

    const observed = await appleProvider.observedMetrics(ADDRESS);

    expect(observed).not.toBeNull();
    expect([...(observed ?? [])].sort()).toEqual(["distance_km", "steps"]);
  });

  it("returns NULL, not an empty array, when nothing has synced yet", async () => {
    // Getting this wrong blanks somebody's whole board on day one. An empty
    // array means "this device produced none of these" and the gate honours it
    // by hiding every wearable pool; a wallet that linked ten minutes ago has
    // observed nothing and must fall back to the declared list.
    supabaseWith(() => []);

    const observed = await appleProvider.observedMetrics(ADDRESS);

    expect(observed).toBeNull();
    expect(observed).not.toEqual([]);
  });

  it("returns NULL when the query fails, rather than narrowing the gate", async () => {
    // Taking pools away because OUR database was unreachable punishes the user
    // for something that has nothing to do with their device.
    getSupabaseServiceRole.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => Promise.resolve({ data: null, error: { message: "boom" } }),
          }),
        }),
      }),
    });

    await expect(appleProvider.observedMetrics(ADDRESS)).resolves.toBeNull();
  });

  it("ignores a stored metric this provider no longer declares", async () => {
    // A row written by an older build under a retired name must not widen the
    // gate to a metric the provider cannot actually serve today.
    supabaseWith((metric) =>
      metric === "steps" || metric === "sleep_score"
        ? [{ day: "2026-09-01", value: 1 }]
        : [],
    );

    const observed = await appleProvider.observedMetrics(ADDRESS);

    expect(observed).toEqual(["steps"]);
    expect(observed).not.toContain("sleep_score");
  });
});
