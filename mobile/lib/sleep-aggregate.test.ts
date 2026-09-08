import { describe, expect, it } from "vitest";

import { aggregateSleep } from "./sleep-aggregate";

// THE DEFECT THIS FILE EXISTS FOR
//
// An Apple Watch does not report one sample per night. It reports a stream of
// short stage segments - core, deep, REM, awake - plus a long inBed span. An
// earlier version bucketed each SEGMENT by the day it ended on, which cut a
// night in half whenever midnight fell inside the sleep period. Someone who
// slept 23:00 to 07:00 got roughly one hour filed on the first day and seven on
// the second, so a "sleep 7 hours" goal could never pay them on any night, and
// the same wallet showed eight sleep days inside a seven-day window.
//
// It is invisible in a timezone where people are asleep across local midnight
// only briefly, and it is a permanent non-payment where they are not. These
// tests pin the grouping that fixes it.

/** A local-time sample, so the tests read the way a night actually happens. */
function sample(value: number, startLocal: string, endLocal: string) {
  return { value, startDate: new Date(startLocal), endDate: new Date(endLocal) };
}

const CORE = 3;
const DEEP = 4;
const REM = 5;
const AWAKE = 2;
const IN_BED = 0;

describe("aggregateSleep", () => {
  it("keeps one night whole when it crosses midnight", () => {
    // The exact shape that used to split: stage segments either side of 00:00.
    const { hours } = aggregateSleep([
      sample(IN_BED, "2026-09-01T23:00:00", "2026-09-02T07:00:00"),
      sample(CORE, "2026-09-01T23:10:00", "2026-09-02T01:00:00"),
      sample(DEEP, "2026-09-02T01:00:00", "2026-09-02T03:00:00"),
      sample(REM, "2026-09-02T03:00:00", "2026-09-02T06:50:00"),
    ]);

    expect(hours).toHaveLength(1);
    expect(hours[0]?.day).toBe("2026-09-02");
    // 1h50 + 2h + 3h50 = 7h40
    expect(hours[0]?.value).toBeCloseTo(7.67, 1);
  });

  it("attributes the night to the day it ends on, not the day it starts", () => {
    const { hours } = aggregateSleep([
      sample(CORE, "2026-09-01T22:30:00", "2026-09-02T06:30:00"),
    ]);
    expect(hours[0]?.day).toBe("2026-09-02");
  });

  it("computes efficiency across the whole night, not per segment", () => {
    // 7h asleep inside an 8h in-bed window is 87.5%. Splitting the night would
    // have produced two wrong numbers and no honest one.
    const { efficiency } = aggregateSleep([
      sample(IN_BED, "2026-09-01T23:00:00", "2026-09-02T07:00:00"),
      sample(CORE, "2026-09-01T23:30:00", "2026-09-02T03:00:00"),
      sample(DEEP, "2026-09-02T03:00:00", "2026-09-02T06:30:00"),
    ]);

    expect(efficiency).toHaveLength(1);
    expect(efficiency[0]?.day).toBe("2026-09-02");
    expect(efficiency[0]?.value).toBeCloseTo(87.5, 1);
  });

  it("does not merge an afternoon nap into the previous night", () => {
    const { hours } = aggregateSleep([
      sample(CORE, "2026-09-01T23:00:00", "2026-09-02T07:00:00"),
      sample(CORE, "2026-09-02T14:00:00", "2026-09-02T15:00:00"),
    ]);

    // Both land on the 2nd, and both count: the person did sleep twice.
    expect(hours).toHaveLength(1);
    expect(hours[0]?.value).toBeCloseTo(9, 1);
  });

  it("bridges a short gap inside one night", () => {
    // Waking for twenty minutes does not end the night.
    const { hours } = aggregateSleep([
      sample(CORE, "2026-09-01T23:00:00", "2026-09-02T02:00:00"),
      sample(AWAKE, "2026-09-02T02:00:00", "2026-09-02T02:20:00"),
      sample(CORE, "2026-09-02T02:20:00", "2026-09-02T06:00:00"),
    ]);

    expect(hours).toHaveLength(1);
    // Awake time is not sleep: 3h + 3h40 = 6h40.
    expect(hours[0]?.value).toBeCloseTo(6.67, 1);
  });

  it("does not count awake time as sleep", () => {
    const { hours } = aggregateSleep([
      sample(CORE, "2026-09-01T23:00:00", "2026-09-02T05:00:00"),
      sample(AWAKE, "2026-09-02T05:00:00", "2026-09-02T06:00:00"),
    ]);
    expect(hours[0]?.value).toBeCloseTo(6, 1);
  });

  it("omits efficiency when the device never reported in-bed time", () => {
    // Efficiency against a missing denominator would be a fabricated 100.
    const { hours, efficiency } = aggregateSleep([
      sample(CORE, "2026-09-01T23:00:00", "2026-09-02T06:00:00"),
    ]);
    expect(hours).toHaveLength(1);
    expect(efficiency).toHaveLength(0);
  });

  it("never reports efficiency above 100", () => {
    // Overlapping stage samples can sum past the in-bed span.
    const { efficiency } = aggregateSleep([
      sample(IN_BED, "2026-09-01T23:00:00", "2026-09-02T06:00:00"),
      sample(CORE, "2026-09-01T23:00:00", "2026-09-02T06:00:00"),
      sample(DEEP, "2026-09-02T01:00:00", "2026-09-02T02:00:00"),
    ]);
    expect(efficiency[0]?.value).toBeLessThanOrEqual(100);
  });

  it("separates two different nights", () => {
    const { hours } = aggregateSleep([
      sample(CORE, "2026-09-01T23:00:00", "2026-09-02T07:00:00"),
      sample(CORE, "2026-09-02T23:00:00", "2026-09-03T07:00:00"),
    ]);

    expect(hours.map((h: { day: string }) => h.day).sort()).toEqual(["2026-09-02", "2026-09-03"]);
    expect(hours.every((h: { value: number }) => Math.abs(h.value - 8) < 0.1)).toBe(true);
  });

  it("returns nothing for a night with no sleep stages at all", () => {
    const { hours, efficiency } = aggregateSleep([
      sample(IN_BED, "2026-09-01T23:00:00", "2026-09-02T07:00:00"),
    ]);
    expect(hours).toHaveLength(0);
    expect(efficiency).toHaveLength(0);
  });

  it("ignores malformed spans rather than producing a wrong total", () => {
    const { hours } = aggregateSleep([
      { value: CORE, startDate: "not-a-date", endDate: "also-not" },
      sample(CORE, "2026-09-02T06:00:00", "2026-09-02T05:00:00"),
      sample(CORE, "2026-09-01T23:00:00", "2026-09-02T06:00:00"),
    ]);
    expect(hours).toHaveLength(1);
    expect(hours[0]?.value).toBeCloseTo(7, 1);
  });
});
