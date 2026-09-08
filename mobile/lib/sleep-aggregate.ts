// Turning raw Apple Health sleep samples into per-day numbers.
//
// Separated from healthkit.ts so this arithmetic can be tested without a
// device: healthkit.ts imports the native module and cannot be loaded off a
// phone. What is here is pure, and it decides whether a sleep pool pays.
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

export interface DayValue {
  /** The wearer's local calendar day, YYYY-MM-DD. */
  day: string;
  value: number;
}

/** One raw HealthKit sleep sample, as this module needs it. */
export interface SleepSample {
  value: number;
  startDate: string | Date;
  endDate: string | Date;
}

/**
 * Turn raw sleep samples into per-day hours and efficiency. Pure, and exported
 * so the money-path arithmetic can be tested without a device.
 */
export function aggregateSleep(
  samples: ReadonlyArray<SleepSample>,
): { hours: DayValue[]; efficiency: DayValue[] } {
  // HKCategoryValueSleepAnalysis: 0 inBed, 1 asleepUnspecified, 2 awake,
  // 3 asleepCore, 4 asleepDeep, 5 asleepREM.
  const ASLEEP = new Set([1, 3, 4, 5]);
  const IN_BED = 0;

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
  const nights: Array<{ asleepMs: number; inBedMs: number; end: number }> = [];
  for (const span of spans) {
    let night = nights[nights.length - 1];
    if (night === undefined || span.start - night.end > NIGHT_GAP_MS) {
      night = { asleepMs: 0, inBedMs: 0, end: span.end };
      nights.push(night);
    }
    night.end = Math.max(night.end, span.end);
    const ms = span.end - span.start;
    if (ASLEEP.has(span.value)) night.asleepMs += ms;
    else if (span.value === IN_BED) night.inBedMs += ms;
  }

  const hoursByDay = new Map<string, number>();
  const effByDay = new Map<string, number>();

  for (const night of nights) {
    if (night.asleepMs <= 0) continue;
    const day = localDay(new Date(night.end));

    // Two nights ending on the same local day (a very early night plus a very
    // late one) are summed, not overwritten, because the person did sleep both.
    hoursByDay.set(day, (hoursByDay.get(day) ?? 0) + night.asleepMs);

    // Some devices report asleep stretches and never inBed. Efficiency against
    // a missing denominator would be a fabricated 100, so such a night is left
    // without an efficiency value rather than given a flattering one.
    if (night.inBedMs > 0) {
      const pct = Math.min(100, (night.asleepMs / night.inBedMs) * 100);
      const prev = effByDay.get(day);
      effByDay.set(day, prev === undefined ? pct : Math.max(prev, pct));
    }
  }

  return {
    hours: [...hoursByDay].map(([day, ms]) => ({
      day,
      value: round(ms / 3_600_000, 2),
    })),
    efficiency: [...effByDay].map(([day, pct]) => ({ day, value: round(pct, 1) })),
  };
}

function round(n: number, places: number): number {
  const f = 10 ** places;
  return Math.round(n * f) / f;
}

/**
 * The wearer's local calendar day. Deliberately not toISOString().slice(0,10),
 * which converts to UTC first and would shift the day for anyone east of
 * Greenwich after their afternoon, or west of it before their morning. Junction
 * keys a night on the device's own calendar date, and Apple has to agree or the
 * same behaviour falls in different buckets per provider.
 */
function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/**
 * A gap longer than this ends a night. Two hours survives a trip to the
 * bathroom or a stretch the watch did not record, and is short enough that an
 * afternoon nap is its own event rather than part of last night.
 */
const NIGHT_GAP_MS = 2 * 60 * 60 * 1000;
