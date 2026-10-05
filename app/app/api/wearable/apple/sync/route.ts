// POST /api/wearable/apple/sync
// Headers: Authorization: Bearer <device token>
// Body: { days: [{ metric, day, value }, ...] }
// Returns: { stored, address }
//
// The GoHealthMe iPhone app posts here. It reads HealthKit on device,
// aggregates each calendar day, and sends the daily numbers. This is the only
// way Apple Health data can reach a server at all: HealthKit is readable only
// on the device that holds it, so there is nothing for the backend to pull.
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
import { putDays } from "@/lib/server/wearable/apple-store";
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

interface ParsedDay {
  metric: WearableMetric;
  day: string;
  value: number;
}

/**
 * Validate the batch completely before writing any of it.
 *
 * All-or-nothing on purpose: a partially accepted batch would leave the wallet
 * with some days stored and some silently dropped, and the verdict would then
 * be computed from an incomplete week without anyone knowing.
 */
function parseDays(input: unknown): ParsedDay[] | string {
  if (!Array.isArray(input)) return "days must be an array";
  if (input.length === 0) return "days must not be empty";
  if (input.length > MAX_DAYS) return `days must contain at most ${MAX_DAYS} entries`;

  // One day past today in UTC, so a phone slightly ahead of us is fine and a
  // forged future window is not. Days are the wearer's LOCAL calendar days, so
  // a wide bound on both sides is correct: a device in Auckland can honestly
  // report a day that has not started in UTC.
  const latest = new Date();
  latest.setUTCDate(latest.getUTCDate() + 1);
  const latestDay = latest.toISOString().slice(0, 10);

  const earliest = new Date();
  earliest.setUTCDate(earliest.getUTCDate() - MAX_BACKFILL_DAYS);
  const earliestDay = earliest.toISOString().slice(0, 10);

  const out: ParsedDay[] = [];
  for (const [i, raw] of input.entries()) {
    if (typeof raw !== "object" || raw === null) return `days[${i}] must be an object`;
    const { metric, day, value } = raw as Record<string, unknown>;

    if (typeof metric !== "string" || !ACCEPTED_METRICS.has(metric)) {
      return `days[${i}].metric is not one Apple Health can report`;
    }
    if (typeof day !== "string" || !DAY_PATTERN.test(day)) {
      return `days[${i}].day must be a YYYY-MM-DD calendar day`;
    }
    if (Number.isNaN(Date.parse(`${day}T00:00:00Z`))) {
      return `days[${i}].day is not a real date`;
    }
    if (day > latestDay) {
      return `days[${i}].day is in the future`;
    }
    if (day < earliestDay) {
      return `days[${i}].day is more than ${MAX_BACKFILL_DAYS} days old`;
    }
    if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
      return `days[${i}].value must be a number at or above zero`;
    }

    out.push({ metric: metric as WearableMetric, day, value });
  }
  return out;
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

    const { days } = body;

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

    const parsed = parseDays(days);
    if (typeof parsed === "string") {
      return jsonError(400, parsed);
    }

    // A configuration gap reported as one. Telling the phone to retry would be
    // a lie: nothing about waiting fixes a missing service-role key, and the
    // app would keep queueing syncs that can never land.
    if (!appleConfigured()) {
      return jsonError(503, "Apple Health sync is not configured on this deployment.");
    }

    // Grouped by metric because the store upserts one metric at a time, and
    // the conflict target is (address, metric, day).
    const byMetric = new Map<WearableMetric, Array<{ day: string; value: number }>>();
    for (const row of parsed) {
      const list = byMetric.get(row.metric) ?? [];
      list.push({ day: row.day, value: row.value });
      byMetric.set(row.metric, list);
    }

    let stored = 0;
    for (const [metric, rows] of byMetric) {
      stored += await putDays(owner, metric, rows);
    }

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
      { stored, address: owner },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (err) {
    return jsonError(502, safeError(err, correlationId));
  }
}
