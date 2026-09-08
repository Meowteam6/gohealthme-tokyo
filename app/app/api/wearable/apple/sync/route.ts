// POST /api/wearable/apple/sync
// Body: { address, days: [{ metric, day, value }, ...] }
// Returns: { stored }
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
// An unsigned post. What lands here decides whether a pool pays. Without the
// signature anyone who knows a wallet address - and every address is public,
// on chain and in this app's own participant lists - could post 20,000 steps a
// day for a stranger and have SPOTTER pay out on it. The wallet signature is
// the whole integrity story for this provider.
//
// A future day. A pool window that has not happened yet cannot be
// pre-satisfied. Enforced here and again by a check constraint on the table,
// because this is the cheapest way to forge a win.
//
// An unknown metric, a negative value, or a nonsense date. All rejected before
// anything is written, so a malformed batch fails loudly rather than storing
// half of itself.

import { isAddress } from "viem";

import {
  errorMessage,
  jsonError,
  newCorrelationId,
  readJsonBody,
  safeError,
} from "@/lib/server/http";
import { requireAddressSignature } from "@/lib/server/wallet-auth";
import { setProviderId } from "@/lib/server/wearable";
import { appleConfigured } from "@/lib/server/wearable/apple";
import { putDays } from "@/lib/server/wearable/apple-store";
import { PROVIDER_METRICS } from "@/lib/server/wearable/metric-vocabulary";
import type { WearableMetric } from "@/lib/server/wearable/types";

/** A phone syncing a week of six metrics sends 42 rows; 400 is a month of slack. */
const MAX_DAYS = 400;

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
  // forged future window is not.
  const latest = new Date();
  latest.setUTCDate(latest.getUTCDate() + 1);
  const latestDay = latest.toISOString().slice(0, 10);

  const out: ParsedDay[] = [];
  for (const [i, raw] of input.entries()) {
    if (typeof raw !== "object" || raw === null) return `days[${i}] must be an object`;
    const { metric, day, value } = raw as Record<string, unknown>;

    if (typeof metric !== "string" || !PROVIDER_METRICS.includes(metric as WearableMetric)) {
      return `days[${i}].metric is not a metric this app knows`;
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

    const { address, days } = body;
    if (typeof address !== "string" || !isAddress(address)) {
      return jsonError(400, "address must be a valid 0x address");
    }

    const auth = await requireAddressSignature(request, address);
    if (!auth.ok) {
      return jsonError(401, `Wallet signature required: ${auth.reason}`);
    }

    // Everything below writes under auth.address, the address RECOVERED from
    // the signature, never the one submitted in the body. The two are proven
    // equal one line above, so this changes no behaviour today. It is here so
    // that a future edit which loosens the comparison, or adds a second way
    // for an address to arrive, cannot turn this into the bug the WHOOP
    // callback had: an address trusted because something adjacent to it was
    // verified. The proven value is the only one this route acts on.
    const owner = auth.address;

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

    // THIS is Apple's callback. The browser tap that started the link recorded
    // nothing, deliberately: nothing confirms it, and a user who reads the
    // instructions and closes the tab must not lose a working provider. Real
    // data arriving from a phone that signed as this wallet is the first
    // moment anything is proven, so the choice is recorded here.
    //
    // Failing to record must not fail the sync: the numbers are already stored
    // and the person's goal does not depend on which provider a dashboard
    // prefers. Logged rather than thrown.
    if (stored > 0) {
      try {
        await setProviderId(owner, "apple");
      } catch (err) {
        console.warn("[wearable/apple/sync] provider choice not recorded", err);
      }
    }

    return Response.json({ stored }, { headers: { "cache-control": "no-store" } });
  } catch (err) {
    return jsonError(502, safeError(err, correlationId));
  }
}
