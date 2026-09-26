// Posting daily aggregates to GoHealthMe.
//
// This is the only path health data takes off the phone, and it carries only
// what lib/healthkit.ts produced: one number per metric per day. There is no
// code here that could send a raw sample even if someone wanted to.

import { collectAggregates, type Aggregates } from "./healthkit";
import { postAggregates, type SyncResult } from "./api";

export type { SyncResult };

/**
 * Read the last `days` days from HealthKit and push the aggregates.
 *
 * Returns what the server actually stored rather than what we sent, so the
 * screen can report the truth instead of assuming the post landed.
 */
export async function syncNow(
  deviceToken: string,
  days = 30,
): Promise<{ sent: number; result: SyncResult }> {
  const aggregates: Aggregates[] = await collectAggregates(days);

  const rows = aggregates.flatMap((a) =>
    a.days.map((d) => ({ metric: a.metric, day: d.day, value: d.value })),
  );

  if (rows.length === 0) {
    // Nothing to send is not an error. A new user, or one who denied the
    // HealthKit sheet, both land here and iOS does not let us tell them apart.
    return { sent: 0, result: { stored: 0 } };
  }

  const result = await postAggregates(deviceToken, rows);
  return { sent: rows.length, result };
}
