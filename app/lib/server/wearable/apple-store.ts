// Storage for wearable aggregates a DEVICE pushes to us, rather than ones we
// pull from a vendor API. Apple Health today.
//
// WHY APPLE NEEDS A STORE AND THE OTHER TWO DO NOT
//
// Junction and WHOOP are cloud APIs: when a verdict needs last week, the
// server asks them and they answer. Apple has no cloud. HealthKit is readable
// only on the device, so the phone is the only thing that can ever see the
// data, and the phone is not reachable when the settle cron runs at 3am. The
// numbers therefore have to be somewhere we can read without a phone, and that
// somewhere is one row per wallet, per metric, per day.
//
// WHAT DELIBERATELY NEVER ARRIVES HERE
//
// Raw samples. The phone aggregates on device and posts a daily total, so
// individual heart-rate readings, sleep stage timings, workout routes and GPS
// traces never leave it. That is a stronger privacy position than the pulled
// providers give us, not a weaker one: with Junction the raw samples exist in
// a vendor's database, and here they exist only on the user's own phone.
//
// This is the only table in this database that holds health data at all, which
// is why the migration and the table comment both say so out loud.
//
// COVERAGE, THE SECOND TABLE, AND WHY A MISS NEEDS IT
//
// A missing wearable_days row is ambiguous: "no workout that day" or "the
// phone never read that day". The miss rule (lib/server/agent/miss.ts) refuses
// to forfeit a stake on that ambiguity, so until coverage existed an Apple
// player who missed was always refunded while a WHOOP player on the same
// challenge lost the stake. wearable_sync_days records every LOCAL day the
// phone read HealthKit for, data or not. A covered day with no row is a real
// zero; an uncovered day is unknown, and unknown refunds. It holds no health
// data: a covered day says nothing about what the person did.
//
// DAYS ARE THE PHONE'S LOCAL CALENDAR DAYS, END TO END
//
// The phone keys each aggregate to the wearer's local day (a night belongs to
// the day it ended on their calendar), and posts the UTC offset it used. The
// server never re-keys: it stores the day as named, and the miss rule places
// the challenge window on that same calendar with the offset. Nothing here is
// UTC except the bounds the server computes for its own reads.

import { getSupabaseServiceRole } from "@/lib/server/supabase";
import type { WearableMetric } from "@/lib/server/wearable/types";

const TABLE = "wearable_days";
const COVERAGE_TABLE = "wearable_sync_days";

/** One device-reported day. `day` is the wearer's LOCAL calendar day. */
export interface WearableDay {
  day: string;
  value: number;
  /**
   * True when the phone knows this day's value is incomplete (a sleep night
   * the stitcher could not close). Counts toward a pass when the value clears
   * the bar; never counts as a covered night for a miss.
   */
  partial?: boolean;
}

/** One local day the phone covered, as the miss rule reads it. */
export interface CoveredDay {
  day: string;
  /** The wearer's UTC offset in seconds at that sync, or null from a phone
   *  build that predates coverage. */
  tzOffsetSec: number | null;
  syncedAt: string;
}

/** Whether the Apple push path can store anything at all. */
export function appleStoreConfigured(): boolean {
  return getSupabaseServiceRole() !== null;
}

/**
 * Upsert a batch of days for one wallet and metric.
 *
 * Upsert rather than insert because a phone re-syncs the same day repeatedly
 * as it accrues: you walk 4,000 steps by lunch and 9,000 by evening, and the
 * evening number must replace the lunchtime one rather than colliding or
 * appending. The primary key (address, metric, day) is the conflict target.
 *
 * `tzOffsetSec` is the wearer's UTC offset at this sync, stored beside every
 * value so the miss rule can place a challenge window on their calendar; null
 * from a phone build that predates it, which the miss rule reads as "cannot
 * place", the refund-only behaviour Apple had before.
 *
 * Returns the number of days written, so the route can report something true
 * rather than assuming success.
 */
export async function putDays(
  address: string,
  metric: WearableMetric,
  days: readonly WearableDay[],
  tzOffsetSec: number | null = null,
): Promise<number> {
  if (days.length === 0) return 0;
  const supabase = getSupabaseServiceRole();
  if (supabase === null) {
    throw new Error("Supabase service role is not configured");
  }

  const rows = days.map((d) => ({
    address: address.toLowerCase(),
    metric,
    day: d.day,
    value: d.value,
    source: "apple",
    tz_offset_sec: tzOffsetSec,
    partial: d.partial === true,
    updated_at: new Date().toISOString(),
  }));

  const { error } = await supabase
    .from(TABLE)
    .upsert(rows, { onConflict: "address,metric,day" });

  if (error) {
    throw new Error(`wearable_days upsert failed: ${error.message}`);
  }
  return rows.length;
}

/**
 * Read one wallet's days for one metric across an inclusive window.
 *
 * A day that is absent is a day with NO DATA, which is not a zero. The verdict
 * has to be able to tell "the watch has not synced" from "you did not walk",
 * so this returns only the days that actually reported and lets the caller
 * count them.
 */
export async function getDays(
  address: string,
  metric: WearableMetric,
  startISO: string,
  endISO: string,
): Promise<WearableDay[]> {
  const supabase = getSupabaseServiceRole();
  if (supabase === null) return [];

  const { data, error } = await supabase
    .from(TABLE)
    .select("day, value, partial")
    .eq("address", address.toLowerCase())
    .eq("metric", metric)
    .gte("day", startISO)
    .lte("day", endISO)
    .order("day", { ascending: false });

  if (error) {
    throw new Error(`wearable_days read failed: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const r = row as { day: string; value: number | string; partial?: boolean | null };
    return {
      day: String(r.day).slice(0, 10),
      value: Number(r.value),
      partial: r.partial === true,
    };
  });
}

/**
 * Record the LOCAL days the phone read HealthKit for in this sync, data or
 * not, with the offset it used. Upsert on (address, day): a re-sync refreshes
 * synced_at and the offset rather than colliding. Duplicates in one batch
 * collapse to one row.
 *
 * Returns the number of distinct days written.
 */
export async function putCoveredDays(
  address: string,
  days: readonly string[],
  tzOffsetSec: number | null,
): Promise<number> {
  const distinct = [...new Set(days)];
  if (distinct.length === 0) return 0;
  const supabase = getSupabaseServiceRole();
  if (supabase === null) {
    throw new Error("Supabase service role is not configured");
  }

  const syncedAt = new Date().toISOString();
  const rows = distinct.map((day) => ({
    address: address.toLowerCase(),
    day,
    tz_offset_sec: tzOffsetSec,
    synced_at: syncedAt,
  }));

  const { error } = await supabase
    .from(COVERAGE_TABLE)
    .upsert(rows, { onConflict: "address,day" });

  if (error) {
    throw new Error(`wearable_sync_days upsert failed: ${error.message}`);
  }
  return rows.length;
}

/**
 * The local days the phone covered inside an inclusive window, newest day
 * first. This is the miss rule's heartbeat for Apple: a covered day with no
 * value is a real zero, an uncovered day is unknown. Empty when the store is
 * not configured, which the miss rule reads as "cannot judge" (tz null).
 */
export async function getCoveredDays(
  address: string,
  startISO: string,
  endISO: string,
): Promise<CoveredDay[]> {
  const supabase = getSupabaseServiceRole();
  if (supabase === null) return [];

  const { data, error } = await supabase
    .from(COVERAGE_TABLE)
    .select("day, tz_offset_sec, synced_at")
    .eq("address", address.toLowerCase())
    .gte("day", startISO)
    .lte("day", endISO)
    .order("day", { ascending: false });

  if (error) {
    throw new Error(`wearable_sync_days read failed: ${error.message}`);
  }

  return (data ?? []).map((row) => {
    const r = row as { day: string; tz_offset_sec?: number | null; synced_at?: string };
    return {
      day: String(r.day).slice(0, 10),
      tzOffsetSec: typeof r.tz_offset_sec === "number" ? r.tz_offset_sec : null,
      syncedAt: String(r.synced_at ?? ""),
    };
  });
}

/**
 * The distinct LOCAL days this wallet reported ANY metric on, inside a window.
 *
 * This is what separates "the phone has not synced" from "the phone synced and
 * this device does not measure that". A tracker that faithfully reports steps
 * but produces no sleep efficiency has days sourced and zero days of sleep
 * data, and telling that person to wait for a sync that already happened is
 * advice that can never come true.
 */
export async function getSourcedDays(
  address: string,
  startISO: string,
  endISO: string,
): Promise<Set<string>> {
  const supabase = getSupabaseServiceRole();
  if (supabase === null) return new Set();

  const { data, error } = await supabase
    .from(TABLE)
    .select("day")
    .eq("address", address.toLowerCase())
    .eq("source", "apple")
    .gte("day", startISO)
    .lte("day", endISO);

  if (error) {
    throw new Error(`wearable_days source probe failed: ${error.message}`);
  }
  return new Set(
    (data ?? []).map((r) => String((r as { day: string }).day).slice(0, 10)),
  );
}

/**
 * The distinct metrics this wallet's hardware has actually produced.
 *
 * Apple can answer this exactly, without an upstream call, because the phone
 * tells us which metrics it computed. An iPhone with no Apple Watch produces
 * steps and distance and no sleep at all, and this is what lets the join gate
 * say so BEFORE somebody stakes on a sleep pool rather than after.
 *
 * `sinceISO` bounds it: a capability is what the hardware reports NOW, not what
 * it once did.
 */
export async function getObservedMetrics(
  address: string,
  sinceISO: string,
): Promise<string[]> {
  const supabase = getSupabaseServiceRole();
  if (supabase === null) return [];

  const { data, error } = await supabase
    .from(TABLE)
    .select("metric")
    .eq("address", address.toLowerCase())
    .eq("source", "apple")
    // BOUNDED IN TIME, and the bound is the whole point.
    //
    // Unbounded, one historical row made a metric "observed" for ever. Somebody
    // who wore a Watch last year, then retired it, kept sleep as a supported
    // capability: the join gate opened, the entry fee moved, and the truth only
    // surfaced at the claim as days-with-data zero. Which is the exact
    // learn-after-the-stake shape this probe exists to prevent.
    //
    // "Observed" has to mean "reported RECENTLY", over the same horizon the
    // verdict will actually read, or the gate is answering a different question
    // from the one that decides the payout.
    .gte("day", sinceISO);

  if (error) {
    throw new Error(`wearable_days metric probe failed: ${error.message}`);
  }
  return [
    ...new Set(
      (data ?? []).map((r) => String((r as { metric: string }).metric)),
    ),
  ];
}

/**
 * Whether this wallet has ever pushed anything from Apple.
 *
 * This is what isConnected asks. It is deliberately "has data arrived", not
 * "did someone tap Set up": for a pushed provider there is no credential to
 * check, so the first sync IS the evidence that a phone is really attached.
 */
export async function hasAnyAppleData(address: string): Promise<boolean> {
  const supabase = getSupabaseServiceRole();
  if (supabase === null) return false;

  const { data, error } = await supabase
    .from(TABLE)
    .select("day")
    .eq("address", address.toLowerCase())
    .eq("source", "apple")
    .limit(1);

  if (error) {
    throw new Error(`wearable_days probe failed: ${error.message}`);
  }
  return (data ?? []).length > 0;
}

/**
 * Forget everything this wallet pushed from Apple.
 *
 * Idempotent: a wallet with nothing stored is already in the desired state.
 * Unlike Junction, Apple can genuinely be disconnected, because the data is
 * ours to delete and the phone stops being asked for more.
 */
export async function deleteAllAppleData(address: string): Promise<void> {
  const supabase = getSupabaseServiceRole();
  if (supabase === null) return;

  const { error } = await supabase
    .from(TABLE)
    .delete()
    .eq("address", address.toLowerCase())
    .eq("source", "apple");

  if (error) {
    throw new Error(`wearable_days delete failed: ${error.message}`);
  }

  // Coverage is pushed by the same phone and means nothing without the days
  // it covered, so forgetting the wallet forgets it too.
  const coverage = await supabase
    .from(COVERAGE_TABLE)
    .delete()
    .eq("address", address.toLowerCase());

  if (coverage.error) {
    throw new Error(`wearable_sync_days delete failed: ${coverage.error.message}`);
  }
}
