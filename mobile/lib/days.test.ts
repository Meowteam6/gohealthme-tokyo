import { describe, expect, it } from "vitest";

import {
  coveredDays,
  localDay,
  localMidnight,
  reportFrom,
  tzOffsetSec,
  windowSince,
} from "./days";

// Pure calendar arithmetic the sync body depends on. The server judges a miss
// only on a day the phone actually covered, so the list of covered days has
// to be every local day in the window, with or without data, and never a UTC
// day by accident.

describe("localDay", () => {
  it("formats the device's local calendar day, not UTC", () => {
    // 23:30 local on the 5th is still the 5th here, whatever UTC says.
    expect(localDay(new Date("2026-10-05T23:30:00"))).toBe("2026-10-05");
    expect(localDay(new Date("2026-10-06T00:10:00"))).toBe("2026-10-06");
  });
});

describe("localMidnight", () => {
  it("is 00:00 local on the same calendar day", () => {
    const m = localMidnight(new Date("2026-10-05T17:45:12"));
    expect(localDay(m)).toBe("2026-10-05");
    expect(m.getHours()).toBe(0);
    expect(m.getMinutes()).toBe(0);
    expect(m.getSeconds()).toBe(0);
  });
});

describe("windowSince", () => {
  it("starts at local midnight, days plus one margin day back", () => {
    const now = new Date("2026-10-06T09:00:00");
    const since = windowSince(30, now);
    expect(localDay(since)).toBe("2026-09-05");
    expect(since.getHours()).toBe(0);
  });

  it("never collapses below one day", () => {
    const now = new Date("2026-10-06T09:00:00");
    expect(localDay(windowSince(0, now))).toBe("2026-10-04");
  });
});

describe("reportFrom", () => {
  // The read starts one day before the first day a sync reports. That margin
  // day is read so the first reported day's night (which begins on the margin
  // day) is whole, but the margin day's own night is cut at its midnight, so
  // it is never reported or covered.
  it("is the day after the read window starts, at local midnight", () => {
    const now = new Date("2026-10-06T09:00:00");
    expect(localDay(reportFrom(30, now))).toBe("2026-09-06");
    expect(localDay(reportFrom(2, now))).toBe("2026-10-04");
    expect(reportFrom(2, now).getHours()).toBe(0);
  });

  it("is always exactly one calendar day after windowSince", () => {
    for (const days of [0, 1, 2, 30]) {
      const now = new Date("2026-10-06T09:00:00");
      const since = windowSince(days, now);
      since.setDate(since.getDate() + 1);
      expect(localDay(reportFrom(days, now))).toBe(localDay(since));
    }
  });
});

describe("coveredDays", () => {
  it("lists every local day from the window start through today, inclusive", () => {
    const days = coveredDays(new Date("2026-10-03T00:00:00"), new Date("2026-10-06T09:00:00"));
    expect(days).toEqual(["2026-10-03", "2026-10-04", "2026-10-05", "2026-10-06"]);
  });

  it("steps by calendar day across a daylight-saving change, not by 24 hours", () => {
    // US clocks spring forward on 2026-03-08; a 24h step would skip or double a day.
    const days = coveredDays(new Date("2026-03-07T00:00:00"), new Date("2026-03-09T12:00:00"));
    expect(days).toEqual(["2026-03-07", "2026-03-08", "2026-03-09"]);
  });

  it("returns one day when the window is a single day", () => {
    expect(coveredDays(new Date("2026-10-06T00:00:00"), new Date("2026-10-06T23:59:00"))).toEqual([
      "2026-10-06",
    ]);
  });

  it("returns nothing for an inverted window instead of looping", () => {
    expect(coveredDays(new Date("2026-10-07T00:00:00"), new Date("2026-10-06T00:00:00"))).toEqual([]);
  });
});

describe("tzOffsetSec", () => {
  it("is the device's UTC offset in seconds, positive east of Greenwich", () => {
    const d = new Date("2026-10-06T12:00:00");
    // JS reports minutes WEST of UTC; the server wants the ISO-8601 sign.
    expect(tzOffsetSec(d)).toBe(-d.getTimezoneOffset() * 60);
    expect(Number.isInteger(tzOffsetSec(d))).toBe(true);
    expect(Math.abs(tzOffsetSec(d))).toBeLessThanOrEqual(14 * 3600);
  });
});
