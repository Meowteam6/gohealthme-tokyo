// Turning raw Apple Health sleep samples into per-day numbers.
//
// Separated from healthkit.ts so this arithmetic can be tested without a
// device: healthkit.ts imports the native module and cannot be loaded off a
// phone. What is here is pure, and it decides whether a sleep challenge pays.
//
// THE DEFECT THIS FILE EXISTS TO PREVENT
//
// An Apple Watch does not report one sample per night. It reports a stream of
// short stage segments - core, deep, REM, awake - plus a long inBed span.
// Bucketing each SEGMENT by the day it ends on cuts a night in half whenever
// midnight falls inside the sleep period: someone who slept 23:00 to 07:00 gets
// about one hour filed on the first day and seven on the second. A "sleep 7
// hours" goal then never pays them on any night, and the same wallet shows
// eight sleep days inside a seven-day window.
//
// So segments are stitched into nights FIRST, and a night is attributed whole.
//
// AND THE SECOND ONE, WHICH APPLE WILL NOT SOLVE FOR YOU
//
// Two sources can describe the same night: a watch plus a third-party sleep
// app, or an iPhone's Sleep Schedule overlapping the watch's stages. Adding
// their durations double counts, and a 7.7 hour night reading as 15.3 clears
// any threshold a challenge could sensibly set.
//
// HealthKit merges overlapping samples for QUANTITY types by default, which is
// why steps need no such handling. Sleep is a CATEGORY sample and no statistics
// query applies to it, so the overlap is merged by hand here or not at all.
//
// TWO THINGS APPLE DOES NOT DOCUMENT, so they are our conventions and are named
// as such rather than presented as platform behaviour: what gap separates two
// sleep sessions (we use two hours), and which calendar day a night belongs to
// (we use the day it ends, which also matches how Junction keys a night).
//
// WHAT NAPS DO, stated because an earlier comment here claimed the opposite.
// A nap is its own NIGHT - the gap rule separates it - but nights ending on the
// same local day are still summed into that day's HOURS. So a six hour night
// plus a ninety minute nap does satisfy a "sleep 7 hours" goal. That is a
// deliberate reading of "did you sleep seven hours today" and it errs in the
// sleeper's favour. Efficiency does NOT work that way: it takes the LONGEST
// night, because otherwise a short nap at perfect efficiency would carry a day
// whose actual night was broken.
//
// WHAT "PARTIAL" MEANS, and why the server needs it.
// The server records a miss only on a day it can trust as final. Three shapes
// of day are not: a day whose only sleep is a nap, a night the Watch stopped
// recording early (under three hours asleep), and a night still in progress
// when the phone synced (its last sample ended less than a night gap ago, so
// the person may still be asleep or the Watch may still be sending). Those
// days carry `partial: true`; the server waits for a later sync before judging
// them. A later sync of the same day overwrites the row, flag included.

import { localDay } from "./days";

/**
 * HKCategoryValueSleepAnalysis raw values.
 *
 * Declared here rather than imported so this module stays free of the native
 * SDK and can be tested off a device. healthkit.ts asserts at COMPILE TIME
 * that these equal the SDK's generated enum, which is produced from Apple's own
 * headers - so if Apple ever renumbers them, the build breaks instead of every
 * sleep number silently changing while eleven tests stay green.
 */
export const SLEEP_IN_BED = 0;
export const SLEEP_ASLEEP_UNSPECIFIED = 1;
export const SLEEP_AWAKE = 2;
export const SLEEP_ASLEEP_CORE = 3;
export const SLEEP_ASLEEP_DEEP = 4;
export const SLEEP_ASLEEP_REM = 5;

/** The stages that count as actually asleep. Awake and inBed do not. */
const ASLEEP: ReadonlySet<number> = new Set([
  SLEEP_ASLEEP_UNSPECIFIED,
  SLEEP_ASLEEP_CORE,
  SLEEP_ASLEEP_DEEP,
  SLEEP_ASLEEP_REM,
]);
const IN_BED = SLEEP_IN_BED;

export interface DayValue {
  /** The wearer's local calendar day, YYYY-MM-DD. */
  day: string;
  value: number;
  /**
   * Set by the sleep stitcher only, and only when the day's sleep is not
   * final: a nap alone, a night cut short, or a night still in progress.
   * Omitted when the value stands, so the wire row stays {metric, day, value}.
   */
  partial?: true;
}

/** One raw HealthKit sleep sample, as this module needs it. */
export interface SleepSample {
  value: number;
  startDate: string | Date;
  endDate: string | Date;
}

/**
 * A gap longer than this ends a night. Two hours survives a trip to the
 * bathroom or a stretch the watch did not record, and is short enough that an
 * afternoon nap is its own event rather than part of last night.
 */
const NIGHT_GAP_MS = 2 * 60 * 60 * 1000;

/**
 * A day whose longest night is shorter than this is partial: a nap, or a
 * night the Watch stopped recording. Three hours is far below any sleep goal a
 * challenge would set and far above any nap, so it separates the two cleanly.
 */
const SHORT_NIGHT_MS = 3 * 60 * 60 * 1000;

/**
 * Turn raw sleep samples into per-day hours and efficiency. Pure, and exported
 * so the money-path arithmetic can be tested without a device.
 *
 * `now` decides whether the most recent night is still open; it defaults to
 * the clock and is passed explicitly by tests.
 */
export function aggregateSleep(
  samples: ReadonlyArray<SleepSample>,
  now: number = Date.now(),
): { hours: DayValue[]; efficiency: DayValue[] } {
  const spans = samples
    .map((s) => ({
      value: s.value,
      start: new Date(s.startDate).getTime(),
      end: new Date(s.endDate).getTime(),
    }))
    .filter((s) => Number.isFinite(s.start) && Number.isFinite(s.end) && s.end > s.start)
    .sort((a, b) => a.start - b.start);

  // GROUP INTO NIGHTS BEFORE ASSIGNING A DAY. This is the whole point of the
  // function and it is easy to get wrong in a way nobody sees.
  //
  // An Apple Watch does not report one sample per night. It reports a stream of
  // short stage segments - core, deep, REM, awake, and a long inBed span - so
  // bucketing each SEGMENT by the day it ends on cuts a night in half whenever
  // midnight falls inside the sleep period. Somebody who slept 23:00 to 07:00
  // would get roughly one hour filed on the first day and seven on the second,
  // and a "sleep 7 hours" goal could then never pay them, on any night, ever.
  // The same wallet would also show eight sleep days inside a seven-day window.
  //
  // So contiguous segments are stitched into one night first, and the night is
  // attributed as a whole. Any gap longer than NIGHT_GAP_MS starts a new night,
  // which also keeps an afternoon nap from being merged into the night before.
  const nights: Array<{
    asleep: Array<{ start: number; end: number }>;
    inBed: Array<{ start: number; end: number }>;
    end: number;
  }> = [];
  for (const span of spans) {
    let night = nights[nights.length - 1];
    if (night === undefined || span.start - night.end > NIGHT_GAP_MS) {
      night = { asleep: [], inBed: [], end: span.end };
      nights.push(night);
    }
    night.end = Math.max(night.end, span.end);
    if (ASLEEP.has(span.value)) night.asleep.push(span);
    else if (span.value === IN_BED) night.inBed.push(span);
  }

  const hoursByDay = new Map<string, number>();
  const longestByDay = new Map<string, number>();
  const openDays = new Set<string>();
  const effByDay = new Map<string, { pct: number; asleepMs: number }>();

  for (const night of nights) {
    // UNION, NOT SUM. Two sources can describe the same sleep: an Apple Watch
    // and a third-party sleep app both recording one night, or an iPhone's
    // Sleep Schedule overlapping the watch's stages. Adding their durations
    // double counts, and a 7.7 hour night reading as 15.3 clears any threshold
    // a challenge could sensibly set.
    //
    // Unlike steps, HealthKit will NOT do this for us: statistics queries work
    // on quantity samples only, and sleep is a category sample. So the overlap
    // has to be merged by hand, here, or it is not merged at all.
    const asleepMs = unionMs(night.asleep);
    const inBedMs = unionMs(night.inBed);
    if (asleepMs <= 0) continue;
    const day = localDay(new Date(night.end));

    // Two nights ending on the same local day (a very early night plus a very
    // late one) are summed, not overwritten, because the person did sleep both.
    hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + asleepMs);
    longestByDay.set(day, Math.max(longestByDay.get(day) ?? 0, asleepMs));

    // A night whose last sample ended less than a night gap ago may still be
    // going: the person is asleep, or the Watch has more to send. Its total
    // is a running count, not the night, and the day says so.
    if (now - night.end < NIGHT_GAP_MS) openDays.add(day);

    // Some devices report asleep stretches and never inBed. Efficiency against
    // a missing denominator would be a fabricated 100, so such a night is left
    // without an efficiency value rather than given a flattering one.
    if (inBedMs > 0) {
      const pct = Math.min(100, (asleepMs / inBedMs) * 100);
      // THE LONGEST NIGHT'S EFFICIENCY, NOT THE BEST.
      //
      // Taking the max let a twenty-minute nap at 100% overwrite a broken
      // night and carry a sleep-efficiency challenge on its own. Efficiency is
      // a quality measure for a night's sleep, so the night that actually was
      // the sleep is the one that should answer for the day.
      const prev = effByDay.get(day);
      if (prev === undefined || asleepMs > prev.asleepMs) {
        effByDay.set(day, { pct, asleepMs });
      }
    }
  }

  const isPartial = (day: string): boolean =>
    openDays.has(day) || (longestByDay.get(day) ?? 0) < SHORT_NIGHT_MS;

  const dayValue = (day: string, value: number): DayValue =>
    isPartial(day) ? { day, value, partial: true } : { day, value };

  return {
    hours: [...hoursByDay].map(([day, ms]) => dayValue(day, round(ms / 3_600_000, 2))),
    efficiency: [...effByDay].map(([day, e]) => dayValue(day, round(e.pct, 1))),
  };
}

/**
 * Total time covered by a set of intervals, counting overlap once.
 *
 * The whole reason sleep needs this and steps does not: HealthKit merges
 * overlapping QUANTITY samples itself, but sleep is a category sample and no
 * statistics query applies to it.
 */
function unionMs(spans: ReadonlyArray<{ start: number; end: number }>): number {
  if (spans.length === 0) return 0;
  const sorted = [...spans].sort((a, b) => a.start - b.start);
  let total = 0;
  let openStart = sorted[0]!.start;
  let openEnd = sorted[0]!.end;
  for (let i = 1; i < sorted.length; i += 1) {
    const s = sorted[i]!;
    if (s.start > openEnd) {
      total += openEnd - openStart;
      openStart = s.start;
      openEnd = s.end;
    } else if (s.end > openEnd) {
      openEnd = s.end;
    }
  }
  return total + (openEnd - openStart);
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}
