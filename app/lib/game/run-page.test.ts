import { describe, expect, it } from "vitest";
import {
  clockLabel,
  closeLabelOf,
  closesWithinDay,
  endsLabel,
  friendMathOf,
  leftLabel,
  nightTimelineOf,
  paidShareText,
  paidSplitOf,
  resultIcs,
  runHeadlineOf,
  soloLineOf,
  stakeTermsOf,
} from "./run-page";
import { paidBreakdown } from "@/lib/game/commitment-copy";

const USDC = 1_000_000n;
// Pool 5: ends Sun 2026-09-27 08:30 JST.
const END = BigInt(Date.parse("2026-09-27T08:30:00+09:00") / 1000);
const TZ = "Asia/Tokyo";

describe("paidShareText", () => {
  it("splits the stake from what the pot paid, and never says SPOTTER paid", () => {
    expect(paidShareText("3.00", USDC, "7 hours")).toBe(
      "I hit 7 hours on GoHealthMe: my 1.00 back plus 2.00 from the pot, in test USDC. Put money on yourself.",
    );
    expect(paidShareText("1.00", USDC, "the goal")).toBe(
      "I hit my goal on GoHealthMe: my 1.00 back, in test USDC. Put money on yourself.",
    );
    expect(paidShareText("0.50", USDC, "7 hours")).toBe(
      "I hit 7 hours on GoHealthMe and got 0.50 back, in test USDC. Put money on yourself.",
    );
    expect(paidShareText("3.00", USDC, "7 hours")).not.toMatch(/SPOTTER/);
  });
});

describe("runHeadlineOf", () => {
  it("names a one-night hours run by the night before its morning close", () => {
    const h = runHeadlineOf({ goalSpec: "Sleep at least 7 hours for 1 night", periodEnd: END, timeZone: TZ });
    expect(h.figure).toBe("7 hours");
    expect(h.rest).toBe("of sleep, Saturday night");
    expect(h.short).toBe("7 hours");
    expect(h.metric).toBe("sleep_hours");
  });

  it("keeps efficiency and steps as their own figures", () => {
    const eff = runHeadlineOf({ goalSpec: "Sleep efficiency 85% or better for 1 night", periodEnd: END, timeZone: TZ });
    expect(eff.figure).toBe("85%");
    expect(eff.rest).toBe("sleep efficiency, Saturday night");
    const steps = runHeadlineOf({ goalSpec: "Walk at least 8,000 steps for 1 day", periodEnd: END, timeZone: TZ });
    expect(steps.figure).toBe("8,000 steps");
  });

  it("names a one-day run that closes in the morning by the day before", () => {
    // Pool 2: one workout, closes Sun 08:00 JST. The lobby says "today" on
    // Saturday evening, so the headline must say Saturday, never Sunday.
    const close = BigInt(Date.parse("2026-09-27T08:00:00+09:00") / 1000);
    const workout = runHeadlineOf({ goalSpec: "Complete at least 1 workout for 1 day", periodEnd: close, timeZone: TZ });
    expect(workout.figure).toBe("1 workout");
    expect(workout.rest).toBe("Saturday");
    // An evening close keeps its own day.
    const evening = BigInt(Date.parse("2026-09-26T22:00:00+09:00") / 1000);
    const steps = runHeadlineOf({ goalSpec: "Walk at least 8,000 steps for 1 day", periodEnd: evening, timeZone: TZ });
    expect(steps.rest).toBe("Saturday");
  });

  it("counts nights for a longer run and has no figure for a document goal", () => {
    const week = runHeadlineOf({ goalSpec: "Sleep 7 hours for 5 nights", periodEnd: END, timeZone: TZ });
    expect(week.rest).toBe("of sleep, on 5 nights");
    const doc = runHeadlineOf({ goalSpec: "Get a dental cleaning", periodEnd: END, timeZone: TZ });
    expect(doc.figure).toBeNull();
  });
});

describe("time labels", () => {
  it("reads the end as day and 24-hour time", () => {
    expect(endsLabel(END, TZ)).toBe("Sun 08:30");
    expect(clockLabel(Number(END) - 7 * 3600, TZ)).toBe("01:30");
  });

  it("says the close in words and knows when it is tonight", () => {
    expect(closeLabelOf(END, TZ)).toBe("08:30 on Sunday");
    expect(closesWithinDay(END, Number(END) - 3600)).toBe(true);
    expect(closesWithinDay(END, Number(END) - 90_000)).toBe(false);
    expect(closesWithinDay(END, Number(END))).toBe(false);
  });

  it("counts down, then stops at the end", () => {
    expect(leftLabel(END, Number(END) - (16 * 3600 + 40 * 60))).toBe("16h 40m");
    expect(leftLabel(END, Number(END) - 90_000)).toBe("1d 1h");
    expect(leftLabel(END, Number(END))).toBeNull();
  });
});

describe("nightTimelineOf", () => {
  it("puts latest asleep at the goal's hours before the close", () => {
    const now = Number(END) - 14 * 3600;
    const t = nightTimelineOf({ nowSec: now, periodEnd: END, goalHours: 7 });
    expect(t).not.toBeNull();
    expect(t?.latestSec).toBe(Number(END) - 7 * 3600);
    expect(t?.latestPct).toBe(50);
    expect(t?.fits).toBe(true);
  });

  it("says when the hours no longer fit, and is gone once the run ends", () => {
    const late = nightTimelineOf({ nowSec: Number(END) - 3 * 3600, periodEnd: END, goalHours: 7 });
    expect(late?.fits).toBe(false);
    expect(late?.latestPct).toBe(0);
    expect(nightTimelineOf({ nowSec: Number(END), periodEnd: END, goalHours: 7 })).toBeNull();
  });
});

describe("money lines", () => {
  const empty = { entryFee: USDC, players: 0, balance: 2n * USDC, feeBps: 0, recordsMisses: true };

  it("states the three outcomes with the run's own stake and sponsor pot", () => {
    const terms = stakeTermsOf({ entryFee: USDC, sponsorPot: 2n * USDC, goalShort: "7 hours", feeBps: 0, recordsMisses: true });
    expect(terms.hitLabel).toBe("Hit 7 hours:");
    expect(terms.hit).toBe("your 1.00 back, plus an equal share of the missed stakes and the 2.00 sponsor pot.");
    expect(terms.miss).toBe(
      "if your wearable shows it, your 1.00 goes to the players who hit. If your wearable sends nothing for the run, it comes back.",
    );
    expect(terms.nobody).toBe("everyone's stake comes back. No cut on this build.");
  });

  it("drops the fee sentence when the fee did not read", () => {
    const terms = stakeTermsOf({ entryFee: USDC, sponsorPot: 0n, goalShort: "the goal", feeBps: null, recordsMisses: true });
    expect(terms.hitLabel).toBe("Hit it:");
    expect(terms.nobody).toBe("everyone's stake comes back.");
  });

  it("never promises a missed stake on a run that cannot record a miss", () => {
    const terms = stakeTermsOf({ entryFee: USDC, sponsorPot: 2n * USDC, goalShort: "7 hours", feeBps: 0, recordsMisses: false });
    expect(terms.hit).toBe("your 1.00 back, plus an equal share of the 2.00 sponsor pot.");
    expect(terms.miss).toBe("this run cannot record a miss, so your 1.00 comes back when it settles.");
    const bare = stakeTermsOf({ entryFee: USDC, sponsorPot: 0n, goalShort: "7 hours", feeBps: 0, recordsMisses: false });
    expect(bare.hit).toBe("your 1.00 back.");
    const two = { entryFee: USDC, players: 2, balance: 2n * USDC, feeBps: 0, recordsMisses: false };
    expect(soloLineOf(two)).toEqual({ kind: "flat", players: 2, total: "1.00" });
    expect(friendMathOf({ ...empty, balance: 0n, recordsMisses: false }, false)).toBeNull();
    // With a sponsor pot, a friend's miss is refunded and you keep the pot.
    expect(friendMathOf({ ...empty, recordsMisses: false }, false)).toEqual({ bothHit: "2.00", friendMisses: "3.00" });
  });

  it("says what a first player gets back alone", () => {
    expect(soloLineOf(empty)).toEqual({ kind: "first", total: "3.00", stake: "1.00", pot: "2.00" });
  });

  it("gives the range once others are in", () => {
    const two = { entryFee: USDC, players: 2, balance: 4n * USDC, feeBps: 0, recordsMisses: true };
    // Three players with the joiner, 2.00 sponsor: everyone hits = 5/3 each (formatUsdc rounds to 1.67), only you = 5.00.
    expect(soloLineOf(two)).toEqual({ kind: "range", players: 2, low: "1.67", high: "5.00" });
    expect(soloLineOf({ ...two, feeBps: null })).toBeNull();
  });

  it("only promises the friend math when it is exact", () => {
    expect(friendMathOf(empty, false)).toEqual({ bothHit: "2.00", friendMisses: "4.00" });
    const justYou = { entryFee: USDC, players: 1, balance: 3n * USDC, feeBps: 0, recordsMisses: true };
    expect(friendMathOf(justYou, true)).toEqual({ bothHit: "2.00", friendMisses: "4.00" });
    expect(friendMathOf(justYou, false)).toBeNull();
  });

  it("splits a paid figure into the stake and the rest", () => {
    expect(paidSplitOf("3.00", USDC)).toEqual({ stake: "1.00", rest: "2.00" });
    expect(paidSplitOf("0.50", USDC)).toBeNull();
    expect(paidSplitOf("n/a", USDC)).toBeNull();
  });

  it("splits a payout exactly as commitment-copy's paidBreakdown words it", () => {
    for (const paid of ["3.00", "1.00", "2.333333", "12.50"]) {
      const split = paidSplitOf(paid, USDC);
      expect(split).not.toBeNull();
      if (split === null) continue;
      const sentence = paidBreakdown(paid, USDC);
      expect(sentence.startsWith(`${split.stake} stake back`)).toBe(true);
      if (split.rest !== "0.00") expect(sentence).toContain(`+ ${split.rest} from missed stakes`);
    }
  });
});

describe("resultIcs", () => {
  it("is one event at the close with the sync instruction", () => {
    const ics = resultIcs({ poolId: 5n, periodEnd: END, title: "Sleep 7 hours Saturday night", deviceName: "WHOOP", nowSec: 1_790_400_000 });
    expect(ics).toContain("DTSTART:20260926T233000Z");
    expect(ics).toContain("UID:pool-5-close@gohealthme");
    expect(ics).toContain("SUMMARY:Have SPOTTER check: Sleep 7 hours Saturday night");
    expect(ics).toContain("Open your WHOOP app so the night syncs");
    expect(ics.split("\r\n")[0]).toBe("BEGIN:VCALENDAR");
  });
});
