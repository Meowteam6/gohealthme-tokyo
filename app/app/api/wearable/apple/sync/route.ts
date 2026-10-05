// POST /api/wearable/apple/sync
// Headers: Authorization: Bearer <device token>
// Body: {
//   days: [{ metric, day, value, partial? }, ...],
//   tzOffsetSec?: number | null,   the wearer's UTC offset in seconds
//   coveredDays?: [day, ...]       every LOCAL day the phone read, data or not
// }
// Returns: { stored, covered, address }
//
// The GoHealthMe iPhone app posts here. It reads HealthKit on device,
// aggregates each LOCAL calendar day, and sends the daily numbers. This is the
// only way Apple Health data can reach a server at all: HealthKit is readable
// only on the device that holds it, so there is nothing for the backend to
// pull.
//
// COVERAGE, AND WHY THE PHONE SAYS WHICH DAYS IT READ
//
// A day with no workouts row is either "no workout" or "the phone never read
// that day", and SPOTTER refuses to forfeit a stake on that ambiguity. So the
// phone also posts the days it covered and the offset it keyed them with
// (lib/server/wearable/apple-store.ts putCoveredDays). That is what lets an
// Apple miss be recorded the way a WHOOP miss is, and an Apple hit be flagged
// by the sweep. A phone built before this (no tzOffsetSec, no coveredDays)
// still syncs: coverage then equals the days it sent data for, the offset is
// unknown, and the miss rule records nothing for it, as before. Coverage is
// recorded only from a batch that also carries data: a batch with no row of
// any metric is a failed or denied read, not a read that found nothing, and
// it must not vouch for days (see POST).
//
// WHAT THIS ROUTE WILL NOT ACCEPT, AND WHY EACH ONE MATTERS
//
// A raw sample. The contract is one aggregate per metric per day. Nothing here
// takes a timestamped reading, so heart-rate series, sleep stage timings,
// workout routes and GPS traces stay on the phone permanently.
//
// A post without a paired device token. What lands here decides whether a
// pool pays. Without it anyone who knows a wallet address - and every address
// is public, on chain and in this app's own participant lists - could post
// 20,000 steps a day for a stranger and have SPOTTER pay out on it. The token
// is issued only to a phone that redeemed a code the wallet's own signed-in
// web session produced (lib/server/wearable/apple-pairing.ts), and the server
// writes under the address the token was issued for, never one the phone names.
//
// A future day. A pool window that has not happened yet cannot be
// pre-satisfied. Enforced here and again by a check constraint on the table
// (supabase/migrations/20260908_wearable_days.sql), because this is the
// cheapest way to forge a win.
//
// An unknown metric, a negative value, or a nonsense date. All rejected before
// anything is written, so a malformed batch fails loudly rather than storing
// half of itself.

import {
  errorMessage,
  jsonError,
  newCorrelationId,
  readJsonBody,
  safeError,
} from "@/lib/server/http";
import { setProviderId } from "@/lib/server/wearable";
import { appleConfigured } from "@/lib/server/wearable/apple";
import { putCoveredDays, putDays } from "@/lib/server/wearable/apple-store";
import { appleProvider } from "@/lib/server/wearable/apple";
import {
  confirmDevice,
  deviceForToken,
  readDeviceToken,
} from "@/lib/server/wearable/apple-pairing";
import type { WearableMetric } from "@/lib/server/wearable/types";

/** A phone syncing a week of six metrics sends 42 rows; 400 is a month of slack. */
const MAX_DAYS = 400;

/**
 * How far back a phone may report.
 *
 * The app collects 30 days, so this is that plus slack for a device that has
 * been offline. It is NOT a security boundary - a signed post is trusted by
 * definition for a pushed provider - but it bounds the blast radius: without
 * it, a wallet could write history for any window in the product's lifetime,
 * including one that closed months ago and is still awaiting settlement.
 */
const MAX_BACKFILL_DAYS = 45;

/**
 * Metrics this route will store, taken from what the provider actually
 * declares rather than from the whole vocabulary.
 *
 * The two differ: `sleep_score` is a real metric that WHOOP serves and Apple
 * cannot, because Apple publishes no proprietary score. Accepting it here would
 * let a phone write rows the provider will never read, and worse, make
 * observedMetrics report a capability the gate would then act on.
 */
const ACCEPTED_METRICS: ReadonlySet<string> = new Set(appleProvider.metrics);

const DAY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The offsets that exist on Earth are UTC-12 to UTC+14. Bounded symmetrically
 * at 14 hours: the eastern edge exactly, two hours of slack west, and no
 * further, because an offset outside this would place a challenge window on
 * a day no wearer has. The table's check constraint carries the same bound.
 */
const MAX_TZ_OFFSET_SEC = 14 * 3600;

interface ParsedDay {
  metric: WearableMetric;
  day: string;
  value: number;
  partial?: true;
}

/**
 * Why a day string is unusable, or null when it is a real LOCAL calendar day
 * inside the bounds. Shared by data days and covered days so the two can
 * never drift: a day the phone may cover is a day it may report on.
 */
function dayProblem(day: unknown, bounds: { earliestDay: string; latestDay: string }): string | null {
  if (typeof day !== "string" || !DAY_PATTERN.test(day)) {
    return "must be a YYYY-MM-DD calendar day";
  }
  if (Number.isNaN(Date.parse(`${day}T00:00:00Z`))) return "is not a real date";
  if (day > bounds.latestDay) return "is in the future";
  if (day < bounds.earliestDay) return `is more than ${MAX_BACKFILL_DAYS} days old`;
  return null;
}

/**
 * The day bounds for this request. One day past today in UTC, so a phone
 * slightly ahead of us is fine and a forged future window is not. Days are
 * the wearer's LOCAL calendar days, so a wide bound on both sides is correct:
 * a device in Auckland can honestly report a day that has not started in UTC.
 */
function dayBounds(): { earliestDay: string; latestDay: string } {
  const latest = new Date();
  latest.setUTCDate(latest.getUTCDate() + 1);
  const earliest = new Date();
  earliest.setUTCDate(earliest.getUTCDate() - MAX_BACKFILL_DAYS);
  return {
    earliestDay: earliest.toISOString().slice(0, 10),
    latestDay: latest.toISOString().slice(0, 10),
  };
}

/**
 * Validate the batch completely before writing any of it.
 *
 * All-or-nothing on purpose: a partially accepted batch would leave the wallet
 * with some days stored and some silently dropped, and the verdict would then
 * be computed from an incomplete week without anyone knowing.
 */
function parseDays(
  input: unknown,
  bounds: { earliestDay: string; latestDay: string },
): ParsedDay[] | string {
  if (!Array.isArray(input)) return "days must be an array";
  // Empty is not a validation error: the phone always posts, even when every
  // HealthKit read failed. What such a batch may do is decided in POST (it
  // records nothing, coverage included); a body with neither data nor
  // coverage is refused there.
  if (input.length > MAX_DAYS) return `days must contain at most ${MAX_DAYS} entries`;

  const out: ParsedDay[] = [];
  for (const [i, raw] of input.entries()) {
    if (typeof raw !== "object" || raw === null) return `days[${i}] must be an object`;
    const { metric, day, value, partial } = raw as Record<string, unknown>;

    if (typeof metric !== "string" || !ACCEPTED_METRICS.has(metric)) {
      return `days[${i}].metric is not one Apple Health can report`;
    }
    const problem = dayProblem(day, bounds);
    if (problem !== null) return `days[${i}].day ${problem}`;
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return `days[${i}].value must be a number at or above zero`;
    }
    if (partial !== undefined && typeof partial !== "boolean") {
      return `days[${i}].partial must be true or false when present`;
    }

    const parsed: ParsedDay = { metric: metric as WearableMetric, day: day as string, value };
    if (partial === true) parsed.partial = true;
    out.push(parsed);
  }
  return out;
}

/**
 * The wearer's UTC offset in seconds, or null when the phone did not say
 * (a build before coverage, or an explicit null). Anything else is refused:
 * a wrong offset places the challenge window on the wrong days, which is a
 * money error in both directions.
 */
function parseTzOffset(input: unknown): number | null | string {
  if (input === undefined || input === null) return null;
  if (
    typeof input !== "number" ||
    !Number.isInteger(input) ||
    input < -MAX_TZ_OFFSET_SEC ||
    input > MAX_TZ_OFFSET_SEC
  ) {
    return `tzOffsetSec must be a whole number of seconds between ${-MAX_TZ_OFFSET_SEC} and ${MAX_TZ_OFFSET_SEC}`;
  }
  return input;
}

/**
 * The LOCAL days the phone read HealthKit for in this sync, data or not.
 * Same date rules and the same cap as data days. Absent means the phone
 * predates coverage, and the days it sent data for stand in (it did read
 * those). Duplicates collapse; order is kept as sent.
 */
function parseCoveredDays(
  input: unknown,
  fallback: readonly ParsedDay[],
  bounds: { earliestDay: string; latestDay: string },
): string[] | string {
  if (input === undefined) return [...new Set(fallback.map((d) => d.day))];
  if (!Array.isArray(input)) return "coveredDays must be an array of YYYY-MM-DD days";
  if (input.length > MAX_DAYS) return `coveredDays must contain at most ${MAX_DAYS} entries`;
  const out: string[] = [];
  for (const [i, day] of input.entries()) {
    const problem = dayProblem(day, bounds);
    if (problem !== null) return `coveredDays[${i}] ${problem}`;
    out.push(day as string);
  }
  return [...new Set(out)];
}

export async function POST(request: Request) {
  const correlationId = newCorrelationId("apple-sync");
  try {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(request);
    } catch (err) {
      return jsonError(400, errorMessage(err));
    }

    const { days, tzOffsetSec, coveredDays } = body;

    const token = readDeviceToken(request);
    const device = token === null ? null : await deviceForToken(token);
    if (token === null || device === null) {
      // Unknown, revoked (the wallet paired another phone) or never paired.
      // The phone turns this into "pair again", which is the only fix.
      return jsonError(401, "This iPhone is not paired. Pair it again from the GoHealthMe website.");
    }

    // Everything below writes under the address the token was ISSUED for.
    // Nothing the phone sends can name a different wallet.
    const owner = device.address;

    // The whole body is validated before anything is written: days, offset,
    // coverage. A batch that is wrong anywhere stores nothing anywhere.
    const bounds = dayBounds();
    const parsed = parseDays(days, bounds);
    if (typeof parsed === "string") {
      return jsonError(400, parsed);
    }
    const offset = parseTzOffset(tzOffsetSec);
    if (typeof offset === "string") {
      return jsonError(400, offset);
    }
    const covered = parseCoveredDays(coveredDays, parsed, bounds);
    if (typeof covered === "string") {
      return jsonError(400, covered);
    }
    if (parsed.length === 0 && covered.length === 0) {
      return jsonError(400, "days must not be empty");
    }

    // A configuration gap reported as one. Telling the phone to retry would be
    // a lie: nothing about waiting fixes a missing service-role key, and the
    // app would keep queueing syncs that can never land.
    if (!appleConfigured()) {
      return jsonError(503, "Apple Health sync is not configured on this deployment.");
    }

    // COVERAGE IS RECORDED ONLY FROM A BATCH THAT CARRIES DATA.
    //
    // The phone runs its five HealthKit queries with allSettled and lists the
    // whole window as covered whatever settled. A sync that fires while the
    // phone is locked has every query throw (HealthKit is sealed behind the
    // passcode), and it arrives here as no days and thirty-one covered days.
    // Recording that coverage would let the miss rule read "covered, no
    // workout" on a day whose workout the phone never saw, and the steps an
    // earlier sync stored would keep getMissEvidence's no-data-at-all guard
    // quiet. A carried iPhone produces steps every day on its own, so a batch
    // with no row of any metric is never a real read: a denied Health sheet,
    // a locked phone, or a build whose queries broke. Answer it, write
    // nothing, and say so, so the phone can tell the person.
    if (parsed.length === 0) {
      console.warn(
        `[wearable/apple/sync] ${correlationId} batch carried ${covered.length} covered days and no data; coverage not recorded`,
      );
      return Response.json(
        { stored: 0, covered: 0, address: owner },
        { headers: { "cache-control": "no-store" } },
      );
    }

    // Grouped by metric because the store upserts one metric at a time, and
    // the conflict target is (address, metric, day).
    const byMetric = new Map<WearableMetric, Array<{ day: string; value: number; partial?: true }>>();
    for (const row of parsed) {
      const list = byMetric.get(row.metric) ?? [];
      const entry: { day: string; value: number; partial?: true } = { day: row.day, value: row.value };
      if (row.partial === true) entry.partial = true;
      list.push(entry);
      byMetric.set(row.metric, list);
    }

    let stored = 0;
    for (const [metric, rows] of byMetric) {
      stored += await putDays(owner, metric, rows, offset);
    }

    // Coverage after the values, so a coverage write that fails leaves the
    // numbers in place (a re-sync upserts both again) and never a covered day
    // whose data did not land, which the miss rule would read as a real zero.
    const coveredStored = await putCoveredDays(owner, covered, offset);

    // THIS is Apple's callback. Neither the browser tap nor redeeming the code
    // recorded anything, deliberately: nothing confirmed them, and a player who
    // pairs and never syncs must not lose a working Junction or WHOOP link.
    // Real data arriving from the paired phone is the first proof, so the
    // choice is recorded here - ONCE per pairing. A later sync must not record
    // it again: a player who paired Apple and then picked WHOOP on the web
    // would otherwise be flipped back to Apple by the phone's next sync.
    // Pairing again is the way back to Apple.
    //
    // Failing to record must not fail the sync: the numbers are already stored
    // and the person's goal does not depend on which provider a dashboard
    // prefers. Logged rather than thrown, and the device stays unconfirmed so
    // the next sync tries again.
    if (stored > 0 && !device.confirmed) {
      try {
        await setProviderId(owner, "apple");
        await confirmDevice(token);
      } catch (err) {
        console.warn("[wearable/apple/sync] provider choice not recorded", err);
      }
    }

    return Response.json(
      { stored, covered: coveredStored, address: owner },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return jsonError(502, safeError(err, correlationId));
  }
}
