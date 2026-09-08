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

import { getSupabaseServiceRole } from "@/lib/server/supabase";
import type { WearableMetric } from "@/lib/server/wearable/types";

const TABLE = "wearable_days";

/** One device-reported day. `day` is the wearer's LOCAL calendar day. */
export interface WearableDay {
  day: string;
  value: number;
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
 * Returns the number of days written, so the route can report something true
 * rather than assuming success.
 */
export async function putDays(
  address: string,
  metric: WearableMetric,
  days: readonly WearableDay[],
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
    .select("day, value")
    .eq("address", address.toLowerCase())
    .eq("metric", metric)
    .gte("day", startISO)
    .lte("day", endISO)
    .order("day", { ascending: false });

  if (error) {
    throw new Error(`wearable_days read failed: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    day: String((row as { day: string }).day).slice(0, 10),
    value: Number((row as { value: number | string }).value),
  }));
}

/**
 * The distinct UTC days this wallet reported ANY metric on, inside a window.
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
}
