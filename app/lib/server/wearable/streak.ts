// The day-counting rules, in one place, for every provider.
//
// WHY THIS IS SHARED AND NOT COPIED
//
// streakDays is the number a pool pays on. If the Junction path and the WHOOP
// path count days even slightly differently, the same person doing the same
// thing gets paid or not depending on which device they happened to link -
// and the on-chain verdict records no provider at all (only a FACET_WEARABLE
// bit), so nothing downstream could ever explain the discrepancy. The
// recovered pre-Junction WHOOP code counted a STRICT CONSECUTIVE RUN and
// junction.ts counts QUALIFYING DAYS IN A WINDOW; shipping both would have
// been exactly that bug.
//
// The window rule wins, and junction.ts already documents why: a single
// missing day of wearable data is a sync gap, not a broken promise, and
// resetting a week of real behaviour over one un-synced night is the kind of
// thing that makes people quit.
//
// Everything here is pure and UTC-only. Provider modules do the fetching and
// the shape-tolerance; they hand this module a map and get the payout numbers
// back.

/**
 * Best value per calendar day, keyed YYYY-MM-DD.
 *
 * "Value", not "score": the metric is whatever the goal names - a sleep score,
 * hours slept, or a step count. Nothing here interprets the unit, which is why
 * one implementation serves every metric.
 */
export type ScoresByDay = ReadonlyMap<string, number>;

/** Days used for the comeback multiplier's baseline: 8-14 back. */
const BASELINE_FIRST_DAY_BACK = 7;
const BASELINE_LAST_DAY_BACK = 14;

function utcKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function utcDate(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00Z`);
}

/**
 * Fold raw per-record values into one best value per calendar day.
 *
 * "Best" rather than "latest" because a day can be reported more than once (a
 * correction, or an overlapping record) and taking the higher value is the
 * reading that does not punish a user for their device re-reporting.
 */
export function bestScorePerDay(
  records: Iterable<{ day: string | null; value: number | null }>,
): Map<string, number> {
  const byDay = new Map<string, number>();
  for (const { day, value } of records) {
    if (day === null || value === null) continue;
    const previous = byDay.get(day);
    if (previous === undefined || value > previous) byDay.set(day, value);
  }
  return byDay;
}

/** The days with a value present, newest first. */
export function scoredDaysNewestFirst(byDay: ScoresByDay): string[] {
  return Array.from(byDay.keys()).sort().reverse();
}

/**
 * Count qualifying days.
 *
 * With a window, every calendar day in [windowStart, min(windowEnd, today)] is
 * checked - progress scoped to the pool's own goal period, counted from when
 * the goal started. Without one, the last `goalDays` ending at the most recent
 * scored night are checked, which is the rolling-streak reading used outside a
 * pool context.
 *
 * A day counts when its best value is at or above `threshold`. Days are
 * counted, never required to be consecutive.
 */
export function countQualifyingDays(
  byDay: ScoresByDay,
  threshold: number,
  goalDays: number,
  windowStartISO?: string,
  windowEndISO?: string,
  now: Date = new Date(),
): number {
  if (byDay.size === 0) return 0;

  let qualifying = 0;

  if (windowStartISO !== undefined) {
    const windowEnd =
      windowEndISO !== undefined && utcDate(windowEndISO) < now
        ? utcDate(windowEndISO)
        : now;
    const cursor = utcDate(windowStartISO);
    // Bounded by the window itself. A malformed window cannot spin: the
    // cursor advances a day every iteration and the end is a fixed instant.
    while (cursor <= windowEnd) {
      const score = byDay.get(utcKey(cursor));
      if (score !== undefined && score >= threshold) qualifying += 1;
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
    return qualifying;
  }

  const newest = scoredDaysNewestFirst(byDay)[0];
  const cursor = utcDate(newest);
  for (let i = 0; i < goalDays; i += 1) {
    const score = byDay.get(utcKey(cursor));
    if (score !== undefined && score >= threshold) qualifying += 1;
    cursor.setUTCDate(cursor.getUTCDate() - 1);
  }
  return qualifying;
}

/**
 * Average score over days 8-14 back from the most recent scored night, or null
 * when that week has no data at all. Feeds the comeback multiplier, which is
 * why it must be null rather than 0 when unknown: a zero would read as "this
 * person slept terribly last week" and inflate the reward.
 */
export function baselineWeekAverage(byDay: ScoresByDay): number | null {
  const days = scoredDaysNewestFirst(byDay);
  if (days.length === 0) return null;

  const scores: number[] = [];
  for (
    let back = BASELINE_FIRST_DAY_BACK;
    back < BASELINE_LAST_DAY_BACK;
    back += 1
  ) {
    const day = utcDate(days[0]);
    day.setUTCDate(day.getUTCDate() - back);
    const score = byDay.get(utcKey(day));
    if (score !== undefined) scores.push(score);
  }

  if (scores.length === 0) return null;
  return scores.reduce((sum, score) => sum + score, 0) / scores.length;
}

/** The per-day series the progress API returns, newest first. */
export function daySeries(
  byDay: ScoresByDay,
): Array<{ date: string; score: number }> {
  return scoredDaysNewestFirst(byDay).map((date) => ({
    date,
    score: byDay.get(date) as number,
  }));
}
