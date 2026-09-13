import { describe, it, expect } from "vitest";
import {
  baselineWeekAverage,
  bestScorePerDay,
  countQualifyingDays,
  daySeries,
  scoredDaysNewestFirst,
} from "@/lib/server/wearable/streak";

// This is the money math. streakDays is the number a pool pays on, and both
// providers route through here precisely so a WHOOP user and a Junction user
// doing the same week get the same answer. The window semantics (count days,
// do not require a consecutive run) are pinned hard: the recovered
// pre-Junction WHOOP code counted a strict run, and letting that back in would
// mean one missing sync night wipes out a paid week.

const AT = new Date("2026-06-22T12:00:00Z");

function map(entries: Record<string, number>): Map<string, number> {
  return new Map(Object.entries(entries));
}

describe("bestScorePerDay", () => {
  it("keeps the highest score when a day is reported more than once", () => {
    const byDay = bestScorePerDay([
      { day: "2026-06-20", value: 71 },
      { day: "2026-06-20", value: 88 },
      { day: "2026-06-21", value: 64 },
    ]);
    // A corrected or overlapping record must not punish the user.
    expect(byDay.get("2026-06-20")).toBe(88);
    expect(byDay.get("2026-06-21")).toBe(64);
  });

  it("drops records with no day or no score rather than scoring them zero", () => {
    const byDay = bestScorePerDay([
      { day: null, value: 90 },
      { day: "2026-06-20", value: null },
      { day: "2026-06-21", value: 80 },
    ]);
    expect([...byDay.keys()]).toEqual(["2026-06-21"]);
  });
});

describe("countQualifyingDays", () => {
  it("counts qualifying days inside a pool window", () => {
    const byDay = map({
      "2026-06-16": 80,
      "2026-06-17": 90,
      "2026-06-18": 70,
      "2026-06-19": 76,
    });
    expect(
      countQualifyingDays(byDay, 75, 7, "2026-06-16", "2026-06-22", AT),
    ).toBe(3);
  });

  it("does NOT require consecutive days - a sync gap is not a broken promise", () => {
    const byDay = map({
      "2026-06-16": 80,
      // 17th missing entirely: the device did not sync.
      "2026-06-18": 82,
      "2026-06-19": 85,
    });
    expect(
      countQualifyingDays(byDay, 75, 7, "2026-06-16", "2026-06-22", AT),
    ).toBe(3);
  });

  it("counts a day exactly on the threshold", () => {
    const byDay = map({ "2026-06-16": 75 });
    expect(
      countQualifyingDays(byDay, 75, 7, "2026-06-16", "2026-06-22", AT),
    ).toBe(1);
  });

  it("never counts past today, even when the pool period runs on", () => {
    const byDay = map({
      "2026-06-21": 90,
      "2026-06-22": 90,
      // Data dated after "now" cannot be counted: it would pay a streak the
      // person has not lived through yet.
      "2026-06-25": 95,
    });
    expect(
      countQualifyingDays(byDay, 75, 30, "2026-06-20", "2026-06-30", AT),
    ).toBe(2);
  });

  it("ignores days outside the window", () => {
    const byDay = map({
      "2026-06-10": 95,
      "2026-06-17": 95,
    });
    expect(
      countQualifyingDays(byDay, 75, 7, "2026-06-16", "2026-06-22", AT),
    ).toBe(1);
  });

  it("falls back to the last goalDays ending at the newest night", () => {
    const byDay = map({
      "2026-06-22": 90,
      "2026-06-21": 90,
      "2026-06-20": 40,
      // Older than the 3-day rolling look-back.
      "2026-06-15": 99,
    });
    expect(countQualifyingDays(byDay, 75, 3, undefined, undefined, AT)).toBe(2);
  });

  it("is zero with no data at all rather than throwing", () => {
    expect(countQualifyingDays(new Map(), 75, 7, undefined, undefined, AT)).toBe(
      0,
    );
    expect(
      countQualifyingDays(new Map(), 75, 7, "2026-06-16", "2026-06-22", AT),
    ).toBe(0);
  });
});

describe("baselineWeekAverage", () => {
  it("averages days 8-14 back from the newest scored night", () => {
    const byDay = map({
      "2026-06-22": 90,
      // 7..13 days back from the 22nd: the 15th through the 9th.
      "2026-06-15": 60,
      "2026-06-14": 70,
      "2026-06-09": 80,
      // Inside the current week, so excluded from the baseline.
      "2026-06-20": 10,
    });
    expect(baselineWeekAverage(byDay)).toBe(70);
  });

  it("is null, never zero, when that week has no data", () => {
    // A zero would read as "slept terribly last week" and inflate the comeback
    // multiplier for someone who simply was not wearing the device.
    expect(baselineWeekAverage(map({ "2026-06-22": 90 }))).toBeNull();
    expect(baselineWeekAverage(new Map())).toBeNull();
  });
});

describe("scoredDaysNewestFirst / daySeries", () => {
  it("orders newest first", () => {
    const byDay = map({
      "2026-06-20": 70,
      "2026-06-22": 90,
      "2026-06-21": 80,
    });
    expect(scoredDaysNewestFirst(byDay)).toEqual([
      "2026-06-22",
      "2026-06-21",
      "2026-06-20",
    ]);
    expect(daySeries(byDay)[0]).toEqual({ date: "2026-06-22", score: 90 });
  });
});
