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

import { collectAggregates, type Aggregates } from "./healthkit";
import { postAggregates, type AggregateRow, type SyncResult } from "./api";
import { coveredDays, reportFrom, tzOffsetSec } from "./days";

export type { SyncResult };

export interface SyncOutcome {
  /** Rows sent: one per metric per day that had data. */
  sent: number;
  /** Distinct local days among those rows. What the screen reports. */
  daysWithData: number;
  /** The local days this sync vouched for. */
  coveredDays: string[];
  /** What the server actually stored. */
  result: SyncResult;
}

/**
 * Read the last `days` days from HealthKit and push the aggregates.
 *
 * Returns what the server actually stored rather than what we sent, so the
 * screen can report the truth instead of assuming the post landed.
 *
 * Always posts, even with no rows. A phone that read a week and found nothing
 * is still a phone that covered the week, and the server needs to know that
 * to judge the week at all.
 */
export async function syncNow(deviceToken: string, days = 30): Promise<SyncOutcome> {
  // One clock for the window, the covered days and the partial-night rule,
  // so a sync that straddles midnight cannot disagree with itself.
  const now = new Date();
  // The first day this sync vouches for. collectAggregates reads one day
  // earlier than this but never returns that margin day, and neither is it
  // covered here: a day is covered only when the phone read all of it.
  const first = reportFrom(days, now);

  const aggregates: Aggregates[] = await collectAggregates(days, now);

  const rows: AggregateRow[] = aggregates.flatMap((a) =>
    a.days.map((d) =>
      d.partial === true
        ? { metric: a.metric, day: d.day, value: d.value, partial: true as const }
        : { metric: a.metric, day: d.day, value: d.value },
    ),
  );
  const covered = coveredDays(first, now);

  const result = await postAggregates(deviceToken, {
    days: rows,
    tzOffsetSec: tzOffsetSec(now),
    coveredDays: covered,
  });

  return {
    sent: rows.length,
    daysWithData: new Set(rows.map((r) => r.day)).size,
    coveredDays: covered,
    result,
  };
}
