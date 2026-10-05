// Calendar arithmetic on the wearer's LOCAL days. Pure, no native imports, so
// every module that keys a number on a day uses the same definition and the
// tests can run off a phone.
//
// WHY LOCAL AND NOT UTC. Junction keys a night on the device's own calendar
// date, so a Sydney wearer who wakes at 08:30 has that night on the day they
// woke up. Keying the same night in UTC would file it on the previous day,
// and at a challenge window's first and last day that is the difference
// between being paid and not. Every day string here is formatted in local
// time, and the server receives the device's offset so it can read them.

/** The wearer's local calendar day as YYYY-MM-DD. */
export function localDay(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** 00:00 local on the same calendar day. The anchor HealthKit buckets from. */
export function localMidnight(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/**
 * Where a sync's READ starts: local midnight, `days` plus one margin day
 * back. The margin closes the hole at the edge of every window: a night whose
 * local day is the first reported day begins on the previous day, and a read
 * anchored exactly at the boundary would cut it at midnight.
 *
 * The margin day itself is read but never reported: see reportFrom.
 */
export function windowSince(days: number, now: Date = new Date()): Date {
  const since = new Date(now);
  since.setDate(since.getDate() - Math.max(1, days) - 1);
  return localMidnight(since);
}

/**
 * The first local day a sync REPORTS and COVERS: one calendar day after the
 * read starts.
 *
 * THE MONEY BUG THIS BOUNDARY EXISTS TO PREVENT. The sleep query starts at
 * windowSince with overlap semantics, so the night that ends on that first
 * read day is missing everything before its midnight: 23:00 to 07:00 reads
 * as 00:00 to 07:00. If that day were posted, a short background sync would
 * overwrite the whole night an earlier 30-day sync stored, and with the day
 * covered, SPOTTER would record a miss on a night the person slept in full.
 * So the first read day is a margin only: read so the next day's night is
 * whole, never posted, never vouched for.
 */
export function reportFrom(days: number, now: Date = new Date()): Date {
  const first = windowSince(days, now);
  first.setDate(first.getDate() + 1);
  return localMidnight(first);
}

/**
 * Every local calendar day from `from` through `to`, inclusive, data or not.
 *
 * This is what the server means by "the phone covered this day": HealthKit
 * was read for it. A day with no rows but inside this list is a real zero or
 * a real absence the phone vouches for; a day outside it was never looked at
 * and must not be judged. Steps by calendar day, never by 24 hours, so a
 * daylight-saving change neither skips nor doubles a day.
 */
export function coveredDays(from: Date, to: Date): string[] {
  const out: string[] = [];
  const last = localDay(to);
  const cursor = localMidnight(from);
  while (localDay(cursor) <= last) {
    out.push(localDay(cursor));
    cursor.setDate(cursor.getDate() + 1);
  }
  return out;
}

/**
 * The device's UTC offset in seconds, positive east of Greenwich (Tokyo is
 * 32400, New York in October is -14400), the same sign as an ISO 8601 offset.
 * JavaScript reports minutes WEST of UTC, so the sign is flipped here once.
 */
export function tzOffsetSec(date: Date = new Date()): number {
  return -date.getTimezoneOffset() * 60;
}
