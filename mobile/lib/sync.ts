// Posting daily aggregates to GoHealthMe.
//
// This is the only path health data takes off the phone, and it carries only
// what lib/healthkit.ts produced: one number per metric per day. There is no
// code here that could send a raw sample even if someone wanted to.
//
// WHAT ELSE A SYNC SAYS, and why. The server decides a missed challenge the
// same way for every provider: a miss is recorded only when the device covered
// every local day of the window, and anything less is refunded. WHOOP's cloud
// tells the server which days it had. For Apple only the phone knows, so each
// sync lists the local days it read HealthKit for, data or not, plus the
// device's timezone so those day strings mean the same thing on both ends.
// Leaving that out would make every Apple player un-missable, which is money
// unfairness between two players on the same challenge.
//
// AND WHAT A SYNC REFUSES TO SAY. Covering a day is a promise that the phone
// read every metric for it. A HealthKit query that threw read nothing, so a
// sync with any unread metric still posts the rows it has but vouches for no
// day, and a sync with no rows and no coverage does not post at all: the
// server would refuse the empty batch, and the person needs one line they
// can act on instead.

import { collectAggregates, METRICS, type Metric } from "./healthkit";
import { postAggregates, type AggregateRow, type SyncResult } from "./api";
import { coveredDays, reportFrom, tzOffsetSec } from "./days";

export type { SyncResult };

/** Shown when no HealthKit query answered, so nothing could be posted. */
export const HEALTH_UNREADABLE =
  "Health could not be read. Check Health access in Settings and try again.";

/** Shown when the server stored no rows and recorded no covered day. */
export const NOTHING_SYNCED =
  "Nothing synced. Check that GoHealthMe is allowed in Settings > Health > Data Access";

/** Shown when rows landed but a metric went unread, so no day was covered. */
export const PARTIAL_READ =
  "Part of Apple Health could not be read this time, so these days are not counted as covered yet. The next sync tries again.";

/**
 * Raised when the phone had nothing it could honestly send: every query
 * threw, or the ones that answered found nothing while another threw.
 * The message is the line the screen shows, with a retry.
 */
export class HealthUnreadableError extends Error {
  constructor() {
    super(HEALTH_UNREADABLE);
    this.name = "HealthUnreadableError";
  }
}

export interface SyncOutcome {
  /** Rows sent: one per metric per day that had data. */
  sent: number;
  /** Distinct local days among those rows. What the screen reports. */
  daysWithData: number;
  /** The local days this sync vouched for. Empty whenever any metric went unread. */
  coveredDays: string[];
  /** Metrics whose HealthKit query threw. Coverage is withheld while any is listed. */
  unread: Metric[];
  /** What the server actually stored. */
  result: SyncResult;
}

/**
 * Read the last `days` days from HealthKit and push the aggregates.
 *
 * Returns what the server actually stored rather than what we sent, so the
 * screen can report the truth instead of assuming the post landed.
 *
 * Posts even with no rows, as long as every query answered. A phone that
 * read a week and found nothing is still a phone that covered the week, and
 * the server needs to know that to judge the week at all.
 *
 * Throws HealthUnreadableError when there is nothing to post: no rows, and
 * no coverage because a query threw.
 */
export async function syncNow(deviceToken: string, days = 30): Promise<SyncOutcome> {
  // One clock for the window, the covered days and the partial-night rule,
  // so a sync that straddles midnight cannot disagree with itself.
  const now = new Date();
  // The first day this sync vouches for. collectAggregates reads one day
  // earlier than this but never returns that margin day, and neither is it
  // covered here: a day is covered only when the phone read all of it.
  const first = reportFrom(days, now);

  const { aggregates, read } = await collectAggregates(days, now);
  const unread: Metric[] = METRICS.filter((m) => !read[m]);

  const rows: AggregateRow[] = aggregates.flatMap((a) =>
    a.days.map((d) =>
      d.partial === true
        ? { metric: a.metric, day: d.day, value: d.value, partial: true as const }
        : { metric: a.metric, day: d.day, value: d.value },
    ),
  );

  // COVERAGE ONLY FROM A COMPLETE READ. The server records a miss on a
  // covered day with no row for the challenge's metric. Any Apple metric can
  // be a challenge, so one thrown query of the five means the phone cannot
  // vouch for any day: it would be claiming "no workout" on a day whose
  // workouts it never saw. The rows it did read are still sent; they are
  // true, they just do not come with a promise about the days around them.
  const covered = unread.length === 0 ? coveredDays(first, now) : [];

  if (rows.length === 0 && covered.length === 0) {
    throw new HealthUnreadableError();
  }

  const result = await postAggregates(deviceToken, {
    days: rows,
    tzOffsetSec: tzOffsetSec(now),
    coveredDays: covered,
  });

  return {
    sent: rows.length,
    daysWithData: new Set(rows.map((r) => r.day)).size,
    coveredDays: covered,
    unread,
    result,
  };
}

/**
 * The one line the screen shows under a sync that landed, or null when there
 * is nothing to say.
 *
 * The server answers stored 0 and covered 0 to a batch with no data rows,
 * which is never a real read: a carried iPhone counts steps on its own. iOS
 * never tells an app what the Health sheet allowed, so this is the only
 * place a denied sheet shows up, and a silent "synced" would be a lie.
 */
export function syncNotice(outcome: SyncOutcome): string | null {
  if (outcome.result.stored === 0 && outcome.result.covered === 0) return NOTHING_SYNCED;
  if (outcome.unread.length > 0) return PARTIAL_READ;
  return null;
}
