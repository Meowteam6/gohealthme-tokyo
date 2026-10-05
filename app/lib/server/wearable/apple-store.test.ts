import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The Apple store, pinned where the money depends on it:
//
//   1. putDays writes the wearer's offset and the partial flag beside each
//      value, because the miss rule cannot place a challenge window on the
//      wearer's calendar without the offset, and a partial night must never
//      count as a covered night.
//   2. Coverage is its own table: a covered day with no row is a real zero,
//      an uncovered day is unknown, and unknown refunds. Without it SPOTTER
//      could never record an Apple miss, and a WHOOP player on the same
//      challenge lost a stake the Apple player kept.
//   3. getDays returns partial, so the provider can hand it to the miss rule.

const from = vi.fn();
const getSupabaseServiceRole = vi.fn();

vi.mock("@/lib/server/supabase", () => ({
  getSupabaseServiceRole: () => getSupabaseServiceRole(),
}));

import {
  getCoveredDays,
  getDays,
  putCoveredDays,
  putDays,
} from "@/lib/server/wearable/apple-store";

const ADDRESS = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";

interface Call {
  table: string;
  op?: string;
  rows?: unknown;
  opts?: unknown;
  filters: Record<string, unknown>;
  select?: string;
  order: Array<{ col: string; ascending: boolean }>;
}

/** A fluent stub keyed by table, answering reads with the rows supplied. */
function supabaseWith(rowsFor: (table: string) => unknown[]) {
  const calls: Call[] = [];
  from.mockImplementation((table: string) => {
    const call: Call = { table, filters: {}, order: [] };
    const chain: Record<string, unknown> = {
      select: (cols: string) => {
        call.select = cols;
        return chain;
      },
      eq: (col: string, val: unknown) => {
        call.filters[col] = val;
        return chain;
      },
      gte: (col: string, val: unknown) => {
        call.filters[`${col}>=`] = val;
        return chain;
      },
      lte: (col: string, val: unknown) => {
        call.filters[`${col}<=`] = val;
        return chain;
      },
      order: (col: string, opts?: { ascending?: boolean }) => {
        call.order.push({ col, ascending: opts?.ascending !== false });
        return chain;
      },
      limit: () => chain,
      upsert: (rows: unknown, opts: unknown) => {
        call.op = "upsert";
        call.rows = rows;
        call.opts = opts;
        calls.push(call);
        return Promise.resolve({ error: null });
      },
      then: (resolve: (v: unknown) => unknown) => {
        calls.push(call);
        return resolve({ data: rowsFor(table), error: null });
      },
    };
    return chain;
  });
  getSupabaseServiceRole.mockReturnValue({ from: (t: string) => from(t) });
  return { calls };
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("putDays", () => {
  it("writes the offset and the partial flag beside each value", async () => {
    const { calls } = supabaseWith(() => []);

    const written = await putDays(
      ADDRESS,
      "sleep_hours",
      [
        { day: "2026-10-04", value: 7.2 },
        { day: "2026-10-05", value: 3.1, partial: true },
      ],
      9 * 3600,
    );

    expect(written).toBe(2);
    const upsert = calls.find((c) => c.op === "upsert");
    expect(upsert?.table).toBe("wearable_days");
    expect(upsert?.opts).toEqual({ onConflict: "address,metric,day" });
    expect(upsert?.rows).toEqual([
      expect.objectContaining({
        address: ADDRESS.toLowerCase(),
        metric: "sleep_hours",
        day: "2026-10-04",
        value: 7.2,
        tz_offset_sec: 32400,
        partial: false,
      }),
      expect.objectContaining({
        day: "2026-10-05",
        value: 3.1,
        tz_offset_sec: 32400,
        partial: true,
      }),
    ]);
  });

  it("writes a null offset for a phone that did not say one", async () => {
    const { calls } = supabaseWith(() => []);
    await putDays(ADDRESS, "steps", [{ day: "2026-10-04", value: 9000 }]);
    const upsert = calls.find((c) => c.op === "upsert");
    expect((upsert?.rows as Array<Record<string, unknown>>)[0]).toMatchObject({
      tz_offset_sec: null,
      partial: false,
    });
  });
});

describe("getDays", () => {
  it("returns the partial flag with each day, false when the row has none", async () => {
    supabaseWith(() => [
      { day: "2026-10-05", value: 3.1, partial: true },
      { day: "2026-10-04", value: 7.2, partial: false },
      { day: "2026-10-03", value: 6.8 },
    ]);

    const days = await getDays(ADDRESS, "sleep_hours", "2026-10-01", "2026-10-07");

    expect(days).toEqual([
      { day: "2026-10-05", value: 3.1, partial: true },
      { day: "2026-10-04", value: 7.2, partial: false },
      { day: "2026-10-03", value: 6.8, partial: false },
    ]);
  });
});

describe("putCoveredDays", () => {
  it("upserts one coverage row per local day with the offset and a sync time", async () => {
    const { calls } = supabaseWith(() => []);

    const written = await putCoveredDays(
      ADDRESS,
      ["2026-10-04", "2026-10-05", "2026-10-04"],
      -4 * 3600,
    );

    // Duplicates collapse: the conflict target is (address, day).
    expect(written).toBe(2);
    const upsert = calls.find((c) => c.op === "upsert");
    expect(upsert?.table).toBe("wearable_sync_days");
    expect(upsert?.opts).toEqual({ onConflict: "address,day" });
    const rows = upsert?.rows as Array<Record<string, unknown>>;
    expect(rows.map((r) => r.day)).toEqual(["2026-10-04", "2026-10-05"]);
    for (const row of rows) {
      expect(row.address).toBe(ADDRESS.toLowerCase());
      expect(row.tz_offset_sec).toBe(-14400);
      expect(typeof row.synced_at).toBe("string");
    }
  });

  it("writes nothing for an empty list", async () => {
    const { calls } = supabaseWith(() => []);
    expect(await putCoveredDays(ADDRESS, [], 0)).toBe(0);
    expect(calls).toHaveLength(0);
  });

  it("throws when the store is not configured, so the sync route reports it", async () => {
    getSupabaseServiceRole.mockReturnValue(null);
    await expect(putCoveredDays(ADDRESS, ["2026-10-04"], 0)).rejects.toThrow(/service role/);
  });
});

describe("getCoveredDays", () => {
  it("reads one wallet's coverage inside a window, newest day first", async () => {
    const { calls } = supabaseWith((table) =>
      table === "wearable_sync_days"
        ? [
            { day: "2026-10-05", tz_offset_sec: 32400, synced_at: "2026-10-05T23:10:00Z" },
            { day: "2026-10-04", tz_offset_sec: null, synced_at: "2026-10-04T22:00:00Z" },
          ]
        : [],
    );

    const covered = await getCoveredDays(ADDRESS, "2026-10-01", "2026-10-07");

    expect(covered).toEqual([
      { day: "2026-10-05", tzOffsetSec: 32400, syncedAt: "2026-10-05T23:10:00Z" },
      { day: "2026-10-04", tzOffsetSec: null, syncedAt: "2026-10-04T22:00:00Z" },
    ]);
    const read = calls.find((c) => c.table === "wearable_sync_days");
    expect(read?.filters).toMatchObject({
      address: ADDRESS.toLowerCase(),
      "day>=": "2026-10-01",
      "day<=": "2026-10-07",
    });
    expect(read?.order[0]).toEqual({ col: "day", ascending: false });
  });

  it("is empty, not an error, when the store is not configured", async () => {
    getSupabaseServiceRole.mockReturnValue(null);
    expect(await getCoveredDays(ADDRESS, "2026-10-01", "2026-10-07")).toEqual([]);
  });
});
