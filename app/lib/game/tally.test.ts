import { describe, expect, it } from "vitest";
import {
  DAY_SECONDS,
  formatRunClock,
  nightTally,
  runClock,
  tallyWords,
} from "@/lib/game/tally";

const START = 1_000_000;
const FIVE_NIGHTS = {
  periodStart: BigInt(START),
  periodEnd: BigInt(START + 5 * DAY_SECONDS),
};

describe("nightTally", () => {
  it("never shows a fake zero before the progress read lands", () => {
    expect(
      nightTally({ goalDays: 5, banked: null, ...FIVE_NIGHTS, nowSec: START }),
    ).toBeNull();
  });

  it("reads 3 of 5 banked mid-run with nights still open", () => {
    const t = nightTally({
      goalDays: 5,
      banked: 3,
      ...FIVE_NIGHTS,
      nowSec: START + 3 * DAY_SECONDS + 10,
    });
    expect(t).not.toBeNull();
    if (t === null) return;
    expect(t.slots).toEqual(["banked", "banked", "banked", "open", "open"]);
    expect(t.nightsLeft).toBe(2);
    expect(t.standing).toBe("alive");
    expect(tallyWords(t)).toBe("3 of 5 nights banked");
  });

  it("marks nights that can no longer count as dead and the run as out", () => {
    const t = nightTally({
      goalDays: 5,
      banked: 1,
      ...FIVE_NIGHTS,
      nowSec: START + 3 * DAY_SECONDS + 10,
    });
    expect(t?.slots).toEqual(["banked", "open", "open", "dead", "dead"]);
    expect(t?.standing).toBe("out");
  });

  it("is on target once enough nights are banked, even before the end", () => {
    const t = nightTally({
      goalDays: 3,
      banked: 4,
      ...FIVE_NIGHTS,
      nowSec: START + DAY_SECONDS,
    });
    expect(t?.banked).toBe(3);
    expect(t?.standing).toBe("on-target");
  });

  it("is over when the period ends short", () => {
    const t = nightTally({
      goalDays: 5,
      banked: 2,
      ...FIVE_NIGHTS,
      nowSec: START + 6 * DAY_SECONDS,
    });
    expect(t?.nightsLeft).toBe(0);
    expect(t?.standing).toBe("over");
    expect(t?.slots.filter((s) => s === "dead")).toHaveLength(3);
  });

  it("counts tonight as a night left on the first day", () => {
    const t = nightTally({ goalDays: 5, banked: 0, ...FIVE_NIGHTS, nowSec: START + 60 });
    expect(t?.nightsLeft).toBe(5);
    expect(t?.standing).toBe("alive");
  });

  it("uses singular words for a one-night goal", () => {
    const t = nightTally({ goalDays: 1, banked: 0, ...FIVE_NIGHTS, nowSec: START });
    expect(t).not.toBeNull();
    if (t !== null) expect(tallyWords(t)).toBe("0 of 1 night banked");
  });
});

describe("runClock", () => {
  it("formats days, hours and minutes left", () => {
    const end = BigInt(START + 2 * DAY_SECONDS + 5 * 3600);
    expect(formatRunClock(runClock(BigInt(START), end, START))).toBe("2d 5h");
    expect(
      formatRunClock(runClock(BigInt(START), BigInt(START + 3 * 3600 + 120), START)),
    ).toBe("3h 2m");
    expect(formatRunClock(runClock(BigInt(START), BigInt(START + 30), START))).toBe("1m");
  });

  it("reads Ended after the period", () => {
    const c = runClock(BigInt(START), BigInt(START + 10), START + 11);
    expect(c.ended).toBe(true);
    expect(formatRunClock(c)).toBe("Ended");
  });
});
