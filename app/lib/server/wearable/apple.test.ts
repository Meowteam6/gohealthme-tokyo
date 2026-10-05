import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// What is pinned here, and why each one is a money or a truth defect:
//
//   1. isConnected is "a phone is attached", never "someone tapped a button".
//      Apple is PUSHED, so there is no credential to validate. A phone that
//      redeemed a pairing code holds a token for this wallet, and data that
//      arrived is proof of the same thing. Tapping Set up creates neither, so
//      someone who never installed the app is still not connected, and a
//      phone that has paired but not synced reads as awaiting its first sync
//      (capability awaiting-sync), never as paired with every declared metric
//      and never as a miss on zero days.
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
import {
  deviceExistsFor,
  deviceForToken,
  mintPairingCode,
  redeemPairingCode,
} from "@/lib/server/wearable/apple-pairing";

const ADDRESS = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";

/** A wallet nobody else in the file store has paired. The pairing module is
 *  real here (JSON files under .data), so device tests use their own address
 *  rather than ADDRESS, and a leftover record can never flip the tests that
 *  pin "nothing has ever been pushed". */
function freshWallet(): string {
  const hex = Array.from({ length: 40 }, () => "0123456789abcdef"[Math.floor(Math.random() * 16)]).join("");
  return `0x${hex}`;
}

/** Pair a phone to `address` the way the app does: mint on the web, redeem on
 *  the phone. Returns the phone's device token. */
async function pairPhone(address: string): Promise<string> {
  const paired = await redeemPairingCode((await mintPairingCode(address)).code);
  if (!paired.ok) throw new Error("pairing failed");
  return paired.deviceToken;
}

function yesterday(): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

function syncRequest(token: string, days: unknown): Request {
  return new Request("https://app.test/api/wearable/apple/sync", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ days }),
  });
}

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

/** One coverage row, as wearable_sync_days returns it. */
interface CoveredRow {
  day: string;
  tz_offset_sec: number | null;
  synced_at?: string;
}

function supabaseWith(
  rowsFor: (metric: string) => Array<{ day: string; value: number; partial?: boolean }>,
  coveredRows: () => CoveredRow[] = () => [],
) {
  const calls: Array<Record<string, unknown>> = [];

  const builder = (table: string) => {
    const state: Record<string, unknown> = { table };
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

        // Coverage lives in its own table: which local days the phone read
        // HealthKit for, data or not.
        if (table === "wearable_sync_days") {
          return resolve({ data: coveredRows(), error: null });
        }

        // select("metric") with no metric filter is the observed-metrics
        // probe: it asks WHICH metrics this wallet has produced, so it must
        // answer with one row per metric that has data.
        if (state.select === "metric") {
          // The probe is window-bounded, so the stub records the bound and
          // answers with the metrics that have rows.
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

  from.mockImplementation((table: string) => builder(table));
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
  it("returns an app handoff with no URL, a pairing code, and reads no health data", async () => {
    supabaseWith(() => []);
    const link = await appleProvider.startLink(ADDRESS);

    expect(link.kind).toBe("app");
    if (link.kind !== "app") throw new Error("expected app link");
    expect(link.linkUrl).toBeNull();
    // Must read correctly on a desktop, where a deep link is useless, and
    // answer "was I charged".
    expect(link.instructions).toContain("iPhone");
    expect(link.instructions).toMatch(/nothing was charged/i);
    expect(link.instructions).toMatch(/no health data has been read yet/i);
    // The code is shown and deep-linked by the panel; the sentence must not
    // tell a person to type something the panel is already handing them.
    expect(link.instructions).not.toMatch(/enter this code/i);
    // Player nouns: challenge and pot. Never run, pool, dare, bet, wager,
    // odds or winner, and no exclamation marks or em-dashes.
    expect(link.instructions).toMatch(/challenges/);
    expect(link.instructions).not.toMatch(/\b(runs?|pools?|dares?|bets?|wagers?|odds|winners?)\b/i);
    expect(link.instructions).not.toMatch(/[!—]/);
    // No health data is touched by tapping Set up: the only thing created is
    // a one-time pairing code the phone app redeems.
    expect(from).not.toHaveBeenCalled();
    expect(link.pairing?.code).toMatch(/^[2-9A-Z]{4}-[2-9A-Z]{4}$/);
    expect(link.pairing?.deepLink.startsWith("gohealthme://pair?code=")).toBe(true);
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

  it("is true once a phone redeemed a code, before any day has arrived", async () => {
    // The defect this pins: a phone that redeemed the code but has not stored
    // a day yet (Health sheet denied, or simply not synced) read as not
    // linked. The web then waited out the code's ten minutes and said it
    // expired, hiding the awaiting-first-sync hold built for this case.
    const address = freshWallet();
    await pairPhone(address);
    supabaseWith(() => []);
    expect(await appleProvider.isConnected(address)).toBe(true);
  });
});

describe("appleLinkState", () => {
  it("is not-linked before any pairing and linked once data arrived", async () => {
    supabaseWith(() => []);
    expect(await appleLinkState(ADDRESS)).toBe("not-linked");

    supabaseWith(() => [{ day: "2026-09-01", value: 1 }]);
    expect(await appleLinkState(ADDRESS)).toBe("linked");
  });

  it("is awaiting-first-sync when a phone redeemed a code and no day has arrived", async () => {
    const address = freshWallet();
    await pairPhone(address);
    supabaseWith(() => []);
    expect(await appleLinkState(address)).toBe("awaiting-first-sync");
  });
});

describe("a paired phone that has not synced: the three answers agree", () => {
  // Pinned as one table because the pairing panel, the join gate and the
  // dashboard each read one of these, and they must describe the same wallet.
  it("redeemed and no rows: connected, capability awaiting-sync", async () => {
    const address = freshWallet();
    await pairPhone(address);
    supabaseWith(() => []);
    expect(await appleProvider.isConnected(address)).toBe(true);
    expect(await appleProvider.observedMetrics(address)).toEqual({ kind: "awaiting-sync" });
  });

  it("rows: connected, capability observed", async () => {
    const address = freshWallet();
    await pairPhone(address);
    supabaseWith((metric) => (metric === "steps" ? [{ day: "2026-09-01", value: 9000 }] : []));
    expect(await appleProvider.isConnected(address)).toBe(true);
    expect((await appleProvider.observedMetrics(address)).kind).toBe("observed");
  });

  it("neither: not connected, capability declared", async () => {
    const address = freshWallet();
    supabaseWith(() => []);
    expect(await appleProvider.isConnected(address)).toBe(false);
    expect(await appleProvider.observedMetrics(address)).toEqual({ kind: "declared" });
  });

  it("a query failure is still unknown when a phone is paired, never awaiting-sync", async () => {
    // We did not learn that no rows exist; we learned nothing. Reporting
    // awaiting-sync would tell a syncing wallet to wait on a sync that has
    // already landed.
    const address = freshWallet();
    await pairPhone(address);
    getSupabaseServiceRole.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () => Promise.resolve({ data: null, error: { message: "down" } }),
            }),
          }),
        }),
      }),
    });
    expect(await appleProvider.observedMetrics(address)).toEqual({ kind: "unknown" });
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

describe("read bounds reach one day past UTC today, so a wearer east of Greenwich is not read a day late", () => {
  // Days are the phone's LOCAL calendar days. At 08:00 in Tokyo it is still
  // yesterday in UTC, and last night's sleep is keyed to the Tokyo day, which
  // is UTC tomorrow. A read bounded at UTC today dropped that night for nine
  // hours. getMissEvidence already reaches to UTC today + 1; the dashboard
  // reads must reach the same way or the card and the verdict disagree.
  function utcTomorrow(): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + 1);
    return d.toISOString().slice(0, 10);
  }

  it("getRecent reads through UTC tomorrow", async () => {
    const { calls } = supabaseWith(() => []);
    await appleProvider.getRecent(ADDRESS, 7);
    const reads = calls.filter((c) => c.table === "wearable_days" && c.op === undefined);
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read.end).toBe(utcTomorrow());
  });

  it("getProgress with no window reads through UTC tomorrow", async () => {
    const { calls } = supabaseWith(() => []);
    await appleProvider.getProgress(ADDRESS, 75, 7);
    const reads = calls.filter((c) => c.op === undefined && c.end !== undefined);
    expect(reads.length).toBeGreaterThan(0);
    for (const read of reads) expect(read.end).toBe(utcTomorrow());
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

  it("revokes the phone, so a sync with the old token is refused and writes nothing", async () => {
    // Privacy defect this pins: disconnect deleted the rows but left the
    // phone's device token valid, so the next background wake refilled the
    // table after the person asked us to forget them. Driven through the real
    // sync route and the real pairing store, with only Supabase stubbed.
    const { POST } = await import("@/app/api/wearable/apple/sync/route");
    const address = freshWallet();
    const token = await pairPhone(address);
    const batch = [{ metric: "steps", day: yesterday(), value: 9000 }];

    // Before: the phone's token lands a day.
    const before = supabaseWith(() => []);
    const accepted = await POST(syncRequest(token, batch));
    expect(accepted.status).toBe(200);
    expect(before.calls.some((c) => c.op === "upsert")).toBe(true);

    await appleProvider.disconnect(address);

    // After: the token is dead, the wallet has no device, and the post is
    // refused before anything is written.
    expect(await deviceForToken(token)).toBeNull();
    expect(await deviceExistsFor(address)).toBe(false);
    const after = supabaseWith(() => []);
    const refused = await POST(syncRequest(token, batch));
    expect(refused.status).toBe(401);
    expect(after.calls.some((c) => c.op === "upsert")).toBe(false);
    expect(await appleProvider.isConnected(address)).toBe(false);
  });

  it("revokes the phone even when no day ever arrived", async () => {
    // A paired, never-synced phone is still a phone that will post later.
    const address = freshWallet();
    const token = await pairPhone(address);
    supabaseWith(() => []);
    await appleProvider.disconnect(address);
    expect(await deviceForToken(token)).toBeNull();
    expect(await appleProvider.isConnected(address)).toBe(false);
  });
});

describe("the sync route and the real store on a read the phone could not finish", () => {
  // The phone withholds coverage when any HealthKit query threw
  // (mobile/lib/sync.ts) and does not post at all when nothing answered.
  // Pinned here from the server's side, through the real route and the real
  // store with only Supabase stubbed: a covered day is a promise the miss
  // rule forfeits a stake on, so a batch that carries rows but vouches for
  // no day must land the rows and write nothing to wearable_sync_days, and
  // a batch with no row of any metric must write nothing anywhere.
  function syncWith(token: string, body: Record<string, unknown>): Request {
    return new Request("https://app.test/api/wearable/apple/sync", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    });
  }

  it("rows with an explicitly empty coveredDays store the rows and no covered day", async () => {
    const { POST } = await import("@/app/api/wearable/apple/sync/route");
    const token = await pairPhone(freshWallet());
    const { calls } = supabaseWith(() => []);

    const res = await POST(
      syncWith(token, {
        days: [{ metric: "steps", day: yesterday(), value: 8000 }],
        tzOffsetSec: 32400,
        coveredDays: [],
      }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 1, covered: 0 });
    const upserts = calls.filter((c) => c.op === "upsert").map((c) => c.table);
    expect(upserts).toEqual(["wearable_days"]);
  });

  it("a batch with no row of any metric writes to neither table, whatever it claims to cover", async () => {
    const { POST } = await import("@/app/api/wearable/apple/sync/route");
    const token = await pairPhone(freshWallet());
    const { calls } = supabaseWith(() => []);

    const res = await POST(
      syncWith(token, { days: [], tzOffsetSec: 0, coveredDays: [yesterday()] }),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ stored: 0, covered: 0 });
    expect(calls.some((c) => c.op === "upsert")).toBe(false);
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
  it("returns observed, narrowed to what this wallet's hardware produced", async () => {
    // The case this exists for: an iPhone with no Apple Watch. Steps and
    // distance arrive, sleep never does. The gate must know that BEFORE the
    // person stakes on a sleep pool.
    supabaseWith((metric) =>
      metric === "steps" || metric === "distance_km"
        ? [{ day: "2026-09-01", value: 9000 }]
        : [],
    );

    const observed = await appleProvider.observedMetrics(ADDRESS);

    expect(observed.kind).toBe("observed");
    if (observed.kind !== "observed") throw new Error("expected observed");
    expect([...observed.metrics].sort()).toEqual([
      "distance_km",
      "steps",
      "workouts",
    ]);
    expect(observed.metrics).not.toContain("sleep_hours");
  });

  it("returns DECLARED, never an empty observed list, when nothing has synced", async () => {
    // Getting this wrong blanks somebody's whole board on day one. An empty
    // array means "this device produced none of these" and the gate honours it
    // by hiding every wearable pool; a wallet that linked ten minutes ago has
    // observed nothing and must fall back to the declared list.
    supabaseWith(() => []);

    // An empty observed list would blank the whole board of a wallet that
    // linked ten minutes ago. Declared is permissive on purpose.
    expect(await appleProvider.observedMetrics(ADDRESS)).toEqual({
      kind: "declared",
    });
  });

  it("returns UNKNOWN when the query fails, never declared", async () => {
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

    // Not declared: our database was unreachable, so we learned nothing.
    // Falling back to the declared list would hand this wallet every metric
    // Apple serves on no evidence, which is how a transient outage becomes
    // somebody staking on a goal their phone cannot prove.
    await expect(appleProvider.observedMetrics(ADDRESS)).resolves.toEqual({
      kind: "unknown",
    });
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

    expect(observed).toEqual({
      kind: "observed",
      metrics: ["steps", "workouts"],
    });
  });

  it("counts workouts as measurable for a syncing phone with no workout rows", async () => {
    // The phone writes a workouts row only on a day with a session, and the
    // verdict reads a missing row as a real zero. The capability probe must
    // agree, or a person who rested for a month is told their hardware cannot
    // count workouts and is refused a workouts run on that false reason.
    supabaseWith((metric) =>
      metric === "steps" ? [{ day: "2026-09-01", value: 8000 }] : [],
    );

    const observed = await appleProvider.observedMetrics(ADDRESS);

    expect(observed.kind).toBe("observed");
    if (observed.kind !== "observed") throw new Error("expected observed");
    expect(observed.metrics).toContain("workouts");
  });
});

describe("observed capability is bounded in time", () => {
  it("asks only about recent days, not all history", async () => {
    // Unbounded, one historical row made a metric supported for ever: someone
    // who wore a Watch last year and retired it kept sleep as a capability, so
    // the gate opened, the fee moved, and the truth surfaced at the claim.
    const { calls } = supabaseWith((metric) =>
      metric === "steps" ? [{ day: "2026-09-01", value: 9000 }] : [],
    );

    await appleProvider.observedMetrics(ADDRESS);

    const probe = calls.find((c) => c.select === "metric");
    expect(probe).toBeDefined();
    // A lower bound was applied at all.
    expect(probe?.start).toBeDefined();
    expect(String(probe?.start)).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe("declared versus unknown, the distinction that stops an outage from staking someone", () => {
  it("returns declared when rows exist but name only retired metrics", async () => {
    // Not "we learned nothing": this is a device whose only recent output is a
    // metric we no longer serve. Declared is the honest answer; an empty
    // observed list would hide every pool from them.
    supabaseWith((metric) =>
      metric === "sleep_score" ? [{ day: "2026-09-01", value: 80 }] : [],
    );

    expect(await appleProvider.observedMetrics(ADDRESS)).toEqual({
      kind: "declared",
    });
  });

  it("never answers declared for a failure, which would widen the gate on no evidence", async () => {
    getSupabaseServiceRole.mockReturnValue({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({
              gte: () =>
                Promise.resolve({ data: null, error: { message: "down" } }),
            }),
          }),
        }),
      }),
    });

    const result = await appleProvider.observedMetrics(ADDRESS);

    expect(result.kind).toBe("unknown");
    expect(result.kind).not.toBe("declared");
  });
});

describe("getProgress counts covered days as nights reported", () => {
  it("an iPhone-only wallet (covered days, no sleep rows) is reported, not awaiting its first sync", async () => {
    // QA 2026-09-26 major: a phone with no Watch syncs steps faithfully and
    // never a night of sleep. nightsReported counted sleep rows only, so the
    // dashboard said "awaiting first sync" for ever. A covered day IS the
    // phone reporting, so the card can say the device sends no sleep data.
    supabaseWith(
      (metric) => (metric === "steps" ? [{ day: "2026-10-04", value: 9000 }] : []),
      () => [
        { day: "2026-10-04", tz_offset_sec: 32400 },
        { day: "2026-10-05", tz_offset_sec: 32400 },
      ],
    );

    const progress = await appleProvider.getProgress(ADDRESS, 75, 7, "2026-10-01", "2026-10-07");

    expect(progress.days).toEqual([]);
    expect(progress.streakDays).toBe(0);
    expect(progress.nightsReported).toBe(2);
  });

  it("a wallet with a phone that has never synced still reads zero nights", async () => {
    supabaseWith(() => [], () => []);
    const progress = await appleProvider.getProgress(ADDRESS, 75, 7, "2026-10-01", "2026-10-07");
    expect(progress.nightsReported).toBe(0);
  });

  it("counts a night once whether it is covered, scored or both", async () => {
    supabaseWith(
      (metric) =>
        metric === "sleep_efficiency"
          ? [
              { day: "2026-10-04", value: 91 },
              { day: "2026-10-05", value: 88 },
            ]
          : [],
      () => [
        { day: "2026-10-05", tz_offset_sec: 32400 },
        { day: "2026-10-06", tz_offset_sec: 32400 },
      ],
    );

    const progress = await appleProvider.getProgress(ADDRESS, 75, 7, "2026-10-01", "2026-10-07");

    expect(progress.nightsReported).toBe(3);
    expect(progress.streakDays).toBe(2);
  });
});

describe("getMissEvidence: Apple on the wearer's own calendar", () => {
  // The whole point: with this read, miss.ts treats an Apple player exactly
  // like a WHOOP player. A miss is recorded only when the phone covered every
  // local day of the challenge and synced after it; anything less refunds.

  it("builds values, heartbeats and the offset from the phone's local days", async () => {
    supabaseWith(
      (metric) =>
        metric === "workouts"
          ? [
              { day: "2026-10-03", value: 1 },
              { day: "2026-10-05", value: 2 },
            ]
          : [],
      () => [
        { day: "2026-10-06", tz_offset_sec: 32400, synced_at: "2026-10-06T01:00:00Z" },
        { day: "2026-10-05", tz_offset_sec: 32400, synced_at: "2026-10-06T01:00:00Z" },
        { day: "2026-10-04", tz_offset_sec: 32400, synced_at: "2026-10-04T13:00:00Z" },
        { day: "2026-10-03", tz_offset_sec: 32400, synced_at: "2026-10-04T13:00:00Z" },
      ],
    );

    const ev = await appleProvider.getMissEvidence!(ADDRESS, "workouts", "2026-10-01");

    expect(ev.values).toEqual({ "2026-10-03": 1, "2026-10-05": 2 });
    // Heartbeats are COVERED days: a covered day with no workouts row is a
    // real zero, and a day the phone never read is unknown.
    expect([...ev.heartbeatDays].sort()).toEqual([
      "2026-10-03",
      "2026-10-04",
      "2026-10-05",
      "2026-10-06",
    ]);
    expect(ev.tzOffsetSec).toBe(32400);
    expect(ev.sourceProblem ?? null).toBeNull();
  });

  it("takes the offset from the newest covered day, skipping rows that carry none", async () => {
    supabaseWith(
      () => [],
      () => [
        { day: "2026-10-06", tz_offset_sec: null },
        { day: "2026-10-05", tz_offset_sec: -14400 },
        { day: "2026-10-04", tz_offset_sec: 32400 },
      ],
    );
    const ev = await appleProvider.getMissEvidence!(ADDRESS, "workouts", "2026-10-01");
    expect(ev.tzOffsetSec).toBe(-14400);
  });

  it("reports a null offset when nothing is covered, which makes the miss rule skip", async () => {
    // Rows from a phone built before coverage shipped: values exist, no
    // calendar. The miss rule records nothing for this wallet (tz-unknown),
    // which is the refund-only behaviour Apple had before.
    supabaseWith(
      (metric) => (metric === "sleep_hours" ? [{ day: "2026-10-04", value: 5 }] : []),
      () => [],
    );
    const ev = await appleProvider.getMissEvidence!(ADDRESS, "sleep_hours", "2026-10-01");
    expect(ev.values).toEqual({ "2026-10-04": 5 });
    expect(ev.heartbeatDays).toEqual([]);
    expect(ev.tzOffsetSec).toBeNull();
  });

  it("marks a partial night so the miss rule never counts it as covered", async () => {
    supabaseWith(
      (metric) =>
        metric === "sleep_hours"
          ? [
              { day: "2026-10-04", value: 7.1, partial: false },
              { day: "2026-10-05", value: 3.2, partial: true },
            ]
          : [],
      () => [
        { day: "2026-10-04", tz_offset_sec: 0 },
        { day: "2026-10-05", tz_offset_sec: 0 },
      ],
    );

    const ev = await appleProvider.getMissEvidence!(ADDRESS, "sleep_hours", "2026-10-01");

    expect(ev.values).toEqual({ "2026-10-04": 7.1, "2026-10-05": 3.2 });
    expect(ev.partialDays).toEqual(["2026-10-05"]);
    expect(ev.tzOffsetSec).toBe(0);
  });

  it("sourceDays are the days the phone reported, so no sleep on a covered day reads as 'does not report', not 'still syncing'", async () => {
    supabaseWith(
      (metric) => (metric === "steps" ? [{ day: "2026-10-04", value: 9000 }] : []),
      () => [{ day: "2026-10-05", tz_offset_sec: 0 }],
    );
    const ev = await appleProvider.getMissEvidence!(ADDRESS, "sleep_hours", "2026-10-01");
    expect([...(ev.sourceDays ?? [])].sort()).toEqual(["2026-10-04", "2026-10-05"]);
    expect(ev.values).toEqual({});
  });

  it("refuses a metric Apple does not serve", async () => {
    supabaseWith(() => []);
    await expect(
      appleProvider.getMissEvidence!(ADDRESS, "sleep_score", "2026-10-01"),
    ).rejects.toThrow(/sleep_score/);
  });

  it("flags a source problem when the phone covers days but has produced no row of any metric", async () => {
    // iOS never tells an app whether Health read access was granted: a denied
    // sheet and an idle wearer both read as "covered, nothing found". A phone
    // that is syncing at all produces steps on its own, so zero rows across
    // the whole read is inconclusive, and inconclusive must refund rather
    // than forfeit a workouts stake.
    supabaseWith(
      () => [],
      () => [
        { day: "2026-10-06", tz_offset_sec: 0 },
        { day: "2026-10-05", tz_offset_sec: 0 },
      ],
    );
    const ev = await appleProvider.getMissEvidence!(ADDRESS, "workouts", "2026-10-01");
    expect(ev.heartbeatDays).toHaveLength(2);
    expect(ev.sourceProblem).toMatch(/no Apple Health data/);
  });

  it("flags no source problem once any metric has a row in the read", async () => {
    supabaseWith(
      (metric) => (metric === "steps" ? [{ day: "2026-10-05", value: 200 }] : []),
      () => [
        { day: "2026-10-06", tz_offset_sec: 0 },
        { day: "2026-10-05", tz_offset_sec: 0 },
      ],
    );
    const ev = await appleProvider.getMissEvidence!(ADDRESS, "workouts", "2026-10-01");
    expect(ev.sourceProblem).toBeNull();
  });
});

describe("appleProvider and the miss rule, end to end through miss.ts", () => {
  // Pool 5's shape: 2026-09-26T02:39:43Z .. 2026-09-26T23:30:00Z, which in
  // Tokyo is Saturday 11:39 to Sunday 08:30, local days 09-26 and 09-27.
  const PERIOD_START = 1_790_390_383n;
  const PERIOD_END = 1_790_465_400n;
  const JST = 9 * 3600;

  async function judge(goalSpec: string, metric: "workouts" | "sleep_hours") {
    const { judgeMissEvidence, missRulePool, missEvidenceFromISO } = await import(
      "@/lib/server/agent/miss"
    );
    const rule = missRulePool(
      { id: 5n, bountyModel: 2, goalSpec },
      1n,
    );
    if (!rule.ok) throw new Error(`fixture goal must qualify: ${goalSpec}`);
    const evidence = await appleProvider.getMissEvidence!(
      ADDRESS,
      metric,
      missEvidenceFromISO(PERIOD_START),
    );
    return judgeMissEvidence({
      spec: rule.spec,
      periodStart: PERIOD_START,
      periodEnd: PERIOD_END,
      evidence,
    });
  }

  // A phone that is syncing produces steps on its own; the fixtures carry a
  // steps row so the read is not "no data of any kind", which refunds.
  const stepsOnly = (metric: string) =>
    metric === "steps" ? [{ day: "2026-09-25", value: 4000 }] : [];

  it("records a workouts miss only when every local day is covered and a sync landed after the window", async () => {
    supabaseWith(stepsOnly, () => [
      { day: "2026-09-28", tz_offset_sec: JST },
      { day: "2026-09-27", tz_offset_sec: JST },
      { day: "2026-09-26", tz_offset_sec: JST },
    ]);
    expect(await judge("Work out for 1 day", "workouts")).toEqual({
      miss: true,
      window: ["2026-09-26", "2026-09-27"],
      qualifyingDays: 0,
    });
  });

  it("refunds a workouts miss when the phone has produced no data of any kind (Health access may be denied)", async () => {
    supabaseWith(
      () => [],
      () => [
        { day: "2026-09-28", tz_offset_sec: JST },
        { day: "2026-09-27", tz_offset_sec: JST },
        { day: "2026-09-26", tz_offset_sec: JST },
      ],
    );
    expect(await judge("Work out for 1 day", "workouts")).toEqual({
      miss: false,
      basis: "source-unhealthy",
    });
  });

  it("refunds when the phone did not cover a day of the window", async () => {
    supabaseWith(stepsOnly, () => [
      { day: "2026-09-28", tz_offset_sec: JST },
      { day: "2026-09-26", tz_offset_sec: JST },
    ]);
    expect(await judge("Work out for 1 day", "workouts")).toEqual({
      miss: false,
      basis: "coverage-gap",
    });
  });

  it("refunds when the phone has not synced since the window closed", async () => {
    supabaseWith(stepsOnly, () => [
      { day: "2026-09-27", tz_offset_sec: JST },
      { day: "2026-09-26", tz_offset_sec: JST },
    ]);
    expect(await judge("Work out for 1 day", "workouts")).toEqual({
      miss: false,
      basis: "no-sync-after-window",
    });
  });

  it("records nothing when the offset is unknown (a phone built before coverage)", async () => {
    supabaseWith(() => [], () => []);
    expect(await judge("Work out for 1 day", "workouts")).toEqual({
      miss: false,
      basis: "tz-unknown",
    });
  });

  it("reaches the met branch for an Apple hit, so the sweep flags it like WHOOP's", async () => {
    supabaseWith(
      (metric) => (metric === "workouts" ? [{ day: "2026-09-27", value: 1 }] : []),
      () => [
        { day: "2026-09-27", tz_offset_sec: JST },
        { day: "2026-09-26", tz_offset_sec: JST },
      ],
    );
    expect(await judge("Work out for 1 day", "workouts")).toEqual({
      miss: false,
      basis: "met",
    });
  });

  it("a sleep miss needs a whole night on every local day of the window", async () => {
    supabaseWith(
      (metric) =>
        metric === "sleep_hours"
          ? [
              { day: "2026-09-27", value: 6.1, partial: false },
              { day: "2026-09-26", value: 5.5, partial: false },
            ]
          : [],
      () => [
        { day: "2026-09-27", tz_offset_sec: JST },
        { day: "2026-09-26", tz_offset_sec: JST },
      ],
    );
    expect(await judge("Sleep 7 hours for 1 night", "sleep_hours")).toEqual({
      miss: true,
      window: ["2026-09-26", "2026-09-27"],
      qualifyingDays: 0,
    });
  });

  it("a partial night refunds a sleep miss", async () => {
    supabaseWith(
      (metric) =>
        metric === "sleep_hours"
          ? [
              { day: "2026-09-27", value: 3.0, partial: true },
              { day: "2026-09-26", value: 5.5, partial: false },
            ]
          : [],
      () => [
        { day: "2026-09-27", tz_offset_sec: JST },
        { day: "2026-09-26", tz_offset_sec: JST },
      ],
    );
    expect(await judge("Sleep 7 hours for 1 night", "sleep_hours")).toEqual({
      miss: false,
      basis: "coverage-gap",
    });
  });

  it("the pass path reads Apple on the wearer's local window once the offset is known", async () => {
    // Before this read existed, runProgress fell back to UTC days for Apple
    // and a Tokyo night landed on the wrong day. With the offset, Saturday
    // night (keyed to Sunday 09-27 local) counts for pool 5.
    const { runProgress } = await import("@/lib/server/agent/miss");
    supabaseWith(
      (metric) => (metric === "sleep_hours" ? [{ day: "2026-09-27", value: 8 }] : []),
      () => [
        { day: "2026-09-27", tz_offset_sec: JST },
        { day: "2026-09-26", tz_offset_sec: JST },
      ],
    );

    const { progress, window } = await runProgress(
      appleProvider,
      ADDRESS,
      { metric: "sleep_hours", threshold: 7 },
      PERIOD_START,
      PERIOD_END,
      new Date((Number(PERIOD_END) + 6 * 3600) * 1000),
    );

    expect(window).toEqual(["2026-09-26", "2026-09-27"]);
    expect(progress.qualifyingDays).toBe(1);
    expect(progress.daysWithSource).toBe(2);
  });
});
