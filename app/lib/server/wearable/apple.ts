// Apple Health as a WearableProvider.
//
// HOW THIS ONE IS DIFFERENT, AND WHY THE INTERFACE ALREADY ALLOWS FOR IT
//
// Junction and WHOOP are PULLED: the server asks a vendor API and it answers.
// Apple cannot be pulled by anyone. HealthKit is readable only on the device
// that holds it, there is no cloud API, and there never will be. So Apple is
// PUSHED: the GoHealthMe iPhone app reads HealthKit, aggregates each day on
// device, and posts the daily numbers to /api/wearable/apple/sync. This module
// reads what landed.
//
// Two consequences the other providers do not have:
//
//   1. The link cannot end at a browser consent page, so startLink returns
//      WearableLink kind "app" and hands the user to the phone. The interface
//      already carries that shape.
//   2. There is no credential to check, so isConnected asks whether data has
//      ever arrived. For a pushed provider the first sync IS the evidence that
//      a phone is really attached to this wallet.
//
// WHAT WE DELIBERATELY NEVER RECEIVE
//
// Raw samples. The phone posts one number per day per metric, so heart-rate
// readings, sleep stage timings, workout routes and GPS traces never leave it.
// That is a stronger privacy position than the pulled providers give us: with
// Junction the raw samples sit in a vendor's database, and here they sit only
// on the user's own phone.
//
// A SLEEP SCORE THAT IS NOT A SLEEP SCORE - READ THIS BEFORE TRUSTING A NUMBER
//
// Apple publishes no proprietary 0-100 sleep score, so "sleep_score" here is
// sleep EFFICIENCY: time asleep over time in bed, computed on device from
// HealthKit's sleep stages. That runs 85-95 for an ordinary sleeper, while
// WHOOP's sleep performance percentage is recovery-weighted and routinely
// lower. A pool written as "sleep score 75+" is therefore close to automatic
// for an Apple user and real work for a WHOOP user, on the same stake for the
// same payout.
//
// The vocabulary split has landed, so Apple declares sleep_efficiency and does
// NOT declare sleep_score. That is the honest outcome even though it blocks
// more pools: a pool authored as "sleep score 75+" is now correctly unjoinable
// for an Apple wallet, surfaced before the stake rather than discovered at the
// claim. Two providers silently answering the same threshold with different
// numbers was a money defect, not a wording one.

//
// HOW A MISS IS JUDGED FOR APPLE (and why it took a second table)
//
// The miss rule (lib/server/agent/miss.ts) forfeits a stake only when the
// wearable covered every local day of the challenge and the data shows the
// goal was not met. For a pulled provider the vendor's records say which days
// the device reported. For Apple the phone says so itself: every sync posts
// the local days it read HealthKit for, data or not (wearable_sync_days), and
// the UTC offset it keyed them with. getMissEvidence turns that into the same
// per-local-day evidence WHOOP and Junction give, so an Apple player who
// misses loses the stake the way a WHOOP player does, and an Apple hit is
// flagged by the sweep without the player opening the page. A phone that
// never said its offset (a build before coverage) gets null, and the rule
// records nothing for it, which is the refund-only behaviour Apple had before.

import { PROVIDER_CAPABILITIES } from "@/lib/provider-capabilities";
import {
  appleStoreConfigured,
  deleteAllAppleData,
  getCoveredDays,
  getDays,
  getObservedMetrics,
  getSourcedDays,
  hasAnyAppleData,
} from "@/lib/server/wearable/apple-store";
import {
  baselineWeekAverage,
  bestScorePerDay,
  countQualifyingDays,
  daySeries,
} from "@/lib/server/wearable/streak";
import { mintPairingCode } from "@/lib/server/wearable/apple-pairing";
import type {
  MetricProgress,
  MissEvidence,
  ObservedCapability,
  WearableLink,
  WearableMetric,
  WearableProgress,
  WearableProvider,
  WearableRecent,
} from "@/lib/server/wearable/types";

/**
 * Whether the server can STORE Apple days at all. The sync route checks this:
 * a development build of the phone app can still post days to a deployment
 * that has the table, whether or not Apple is offered to players.
 */
export function appleConfigured(): boolean {
  return appleStoreConfigured();
}

/**
 * Whether a real player can install the phone app that feeds this provider.
 *
 * Apple Health has no web OAuth; the only way in is the GoHealthMe iPhone
 * app, and that app has no public build yet (development-client profiles
 * only). Offering Apple in the picker because the database happens to exist
 * sent every beta user to "open the app on your iPhone" for an app they
 * cannot get, and left them with no sensor and every run locked. So Apple is
 * offered only when the deployment says the app actually ships.
 *
 * Opt-in on an explicit flag rather than inferred, because nothing on the
 * server can observe whether an App Store or TestFlight build exists.
 */
export function appleAppAvailable(): boolean {
  return process.env.APPLE_APP_AVAILABLE?.trim() === "1";
}

/**
 * What the connect surface tells the user, when there is no URL to open.
 *
 * Written to be true on a desktop browser, where a deep link would be useless,
 * and to close the two questions someone reading it will actually have: was I
 * charged, and has anything of mine been read.
 */
const APP_HANDOFF_INSTRUCTIONS =
  "Apple Health can only be read on your iPhone. Open the GoHealthMe app " +
  "there, enter this code, and allow Apple Health when it asks. Your runs " +
  "switch to Apple Health once the first day arrives from the phone; until " +
  "then anything you already connected keeps counting. Nothing was charged " +
  "and no health data has been read yet.";

/**
 * Where a player gets the iPhone app (a TestFlight public link during the
 * beta). Optional: without it the copy still says what to open, it just has
 * no link to hand over.
 */
export function appleInstallUrl(): string | null {
  const raw = process.env.APPLE_APP_INSTALL_URL?.trim() ?? "";
  return raw.startsWith("https://") ? raw : null;
}

/**
 * Where a wallet sits in the Apple link, in the shared vocabulary.
 *
 * "not-linked" nothing has ever arrived from a phone for this wallet
 * "linked"     days have arrived; the watch is reporting
 *
 * Apple never reports "awaiting-first-sync": nothing is created server-side
 * when someone taps Set up, so there is no in-between to be in. Either a phone
 * has pushed or it has not. "metric-unavailable" is decided per goal by
 * daysWithSource, not here.
 */
export type AppleLinkState = "not-linked" | "linked";

export async function appleLinkState(address: string): Promise<AppleLinkState> {
  return (await hasAnyAppleData(address)) ? "linked" : "not-linked";
}

/**
 * Metrics where an unreported day means the person did NOT do the thing, not
 * that the device failed to report.
 *
 * You either did a workout or you did not; a day with no workout row is a real
 * zero. Steps and sleep are the opposite: a missing day means the phone did not
 * sync, and reading it as zero would tell someone who walked 12,000 that they
 * missed. Junction and WHOOP mark every day sourced for these same two, so
 * diverging here would pay differently by provider.
 *
 * Days here, as everywhere in this module, are the phone's LOCAL calendar
 * days: the phone keys each aggregate to the wearer's day and the server
 * stores it as named. The miss rule needs more than "a row exists" to call a
 * day a real zero (the phone must have covered it, getMissEvidence); the pass
 * path only ever pays, so sourced-at-all is enough for it.
 */
const EVERY_DAY_SOURCED: ReadonlySet<string> = new Set([
  "workouts",
  "distance_km",
]);

/** Every calendar day in an inclusive YYYY-MM-DD window. The arithmetic is
 *  done in UTC on purpose: the keys are the wearer's local day names, and a
 *  day name advances the same way whatever calendar it came from. */
function daysInWindow(startISO: string, endISO: string): string[] {
  const out: string[] = [];
  const cursor = new Date(`${startISO}T00:00:00Z`);
  const end = new Date(`${endISO}T00:00:00Z`);
  while (cursor <= end) {
    out.push(cursor.toISOString().slice(0, 10));
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

/**
 * How far back "this device can do that" is answered over.
 *
 * Matches the window the phone collects, so the gate and the verdict are
 * answering the same question. Longer and a retired Watch keeps a capability;
 * much shorter and somebody who simply has not opened the app in a fortnight
 * loses pools they can genuinely satisfy.
 */
const OBSERVED_WINDOW_DAYS = 30;

/** Empty progress, used whenever the wallet has nothing to read yet. */
const NO_PROGRESS: WearableProgress = {
  streakDays: 0,
  baselineWeekAvg: null,
  days: [],
  nightsReported: 0,
};

export const appleProvider: WearableProvider = {
  id: "apple",
  label: "Apple Health",
  readService: "apple-read",
  readLabel: "wearable summary (Apple Health)",
  // Genuinely zero: the read is a query against our own table, not a metered
  // vendor call. Borrowing Junction's estimate would put a charge on the agent
  // receipt that never happens.
  readEstUsd: "0.00",
  // Apple Watch plus iPhone covers the whole vocabulary. Apple is the only one
  // of the three that can verify a steps goal - a WHOOP strap has no pedometer
  // - so shrinking this list makes pools unjoinable for real people.
  // There is no consent page: HealthKit is readable only on the device, so the
  // link ends by handing the user to the phone and nothing here confirms it.
  linkKind: "app",
  metrics: PROVIDER_CAPABILITIES.apple,

  async startLink(address: string): Promise<WearableLink> {
    // The link route verified this wallet's signature before calling here, so
    // this is the one moment the server can vouch for the phone: a short,
    // single-use code the phone redeems for its device token. Nothing else is
    // provisioned, and no provider choice is recorded until data arrives.
    return {
      kind: "app",
      linkUrl: null,
      instructions: APP_HANDOFF_INSTRUCTIONS,
      pairing: await mintPairingCode(address),
      installUrl: appleInstallUrl(),
    };
  },

  isConnected(address: string): Promise<boolean> {
    // For a pushed provider there is no credential to validate, so the honest
    // question is whether a phone has ever reported. Answering "yes" because
    // someone tapped a button would tell a person who never installed the app
    // that their watch is connected, and then read zero days and say they
    // missed the goal.
    return hasAnyAppleData(address);
  },

  /**
   * What THIS wallet's hardware has actually produced.
   *
   * Apple can answer exactly, with no upstream call and no cache staleness,
   * because the phone tells us which metrics it computed. An iPhone with no
   * Apple Watch produces steps and distance and no sleep at all, and this is
   * what lets the join gate say so BEFORE somebody stakes on a sleep pool
   * instead of after.
   *
   * TWO WAYS TO GET THIS WRONG, BOTH OF WHICH TAKE POOLS AWAY FROM SOMEONE:
   *
   * Returning [] when nothing has synced yet. An empty array means "this
   * device produced none of these", which the gate honours by hiding every
   * wearable pool. A wallet that linked ten minutes ago has observed nothing
   * and must fall back to the declared list, so it gets null.
   *
   * Returning [] on a query failure. Narrowing the gate because our own
   * database was unreachable takes pools away for a reason that has nothing
   * to do with the user's device. Errors are null too.
   */
  async observedMetrics(address: string): Promise<ObservedCapability> {
    // The same horizon the phone collects and the verdict reads. Asking a
    // wider question than the payout asks would let a retired device keep a
    // capability it can no longer deliver.
    const since = daysBefore(isoDay(new Date()), OBSERVED_WINDOW_DAYS);

    let observed: string[];
    try {
      observed = await getObservedMetrics(address, since);
    } catch {
      // UNKNOWN, not declared. Our database was unreachable, so we found out
      // nothing. Falling back to the declared list here would hand a wallet
      // every metric Apple can serve on no evidence, which is how a transient
      // outage becomes somebody staking on a goal their phone cannot prove.
      return { kind: "unknown" };
    }

    // DECLARED, not observed-with-an-empty-list. Nothing has arrived yet, so
    // there is nothing to narrow, and an empty observed list would blank the
    // whole board of a wallet that linked ten minutes ago.
    if (observed.length === 0) return { kind: "declared" };

    // Intersect with what this provider declares, so a row written by an older
    // build under a retired metric name cannot widen the gate.
    const declared = new Set<string>(appleProvider.metrics);
    const seen = observed.filter((m) => declared.has(m)) as WearableMetric[];

    // Rows exist but none of them name a metric Apple still serves. That is
    // not "we learned nothing", it is a device whose only recent output is a
    // metric we retired, so declared is the honest answer rather than an empty
    // observed list that would hide every pool.
    if (seen.length === 0) return { kind: "declared" };

    // Workouts are a COUNT: the phone writes a row only on a day with a
    // session, and the verdict reads a missing row as a real zero
    // (EVERY_DAY_SOURCED). A phone that is syncing anything can therefore be
    // judged on workouts even when the window holds none; the iPhone records
    // them through the Fitness app with or without a Watch. Leaving it out
    // told a person who rested for a month that their hardware cannot count
    // workouts, and refused them a workouts run on that false reason.
    if (!seen.includes("workouts") && declared.has("workouts")) {
      seen.push("workouts");
    }

    return { kind: "observed", metrics: seen };
  },

  async getMetricProgress(
    address: string,
    metric: WearableMetric,
    threshold: number,
    windowStartISO: string,
    windowEndISO: string,
  ): Promise<MetricProgress> {
    const [rows, sourced] = await Promise.all([
      getDays(address, metric, windowStartISO, windowEndISO),
      getSourcedDays(address, windowStartISO, windowEndISO),
    ]);
    const byDay = bestScorePerDay(
      rows.map((r) => ({ day: r.day, value: r.value })),
    );

    // For a count metric, every day the phone was syncing counts as sourced
    // even where no row exists, because "no workout logged" is an answer and
    // not a gap. Anything else is sourced only on the days that reported.
    const daysWithSource = EVERY_DAY_SOURCED.has(metric)
      ? sourced.size === 0
        ? 0
        : daysInWindow(windowStartISO, windowEndISO).length
      : sourced.size;

    return {
      qualifyingDays: countQualifyingDays(
        byDay,
        threshold,
        0,
        windowStartISO,
        windowEndISO,
      ),
      // Days carrying a value for THIS metric.
      daysWithData: byDay.size,
      // Days the phone reported anything at all. daysWithSource 0 means it has
      // not synced, which waiting fixes. daysWithSource > 0 with daysWithData 0
      // means this device does not measure it, which waiting never fixes, and
      // telling that person to wait is advice that can never come true.
      daysWithSource,
    };
  },

  /**
   * Per-local-day evidence for the miss rule (lib/server/agent/miss.ts).
   *
   * values         the stored value per local day for this metric (the phone
   *                posts one aggregate per day, so no merging is needed)
   * heartbeatDays  the days the phone COVERED (read HealthKit for, data or
   *                not). A covered day with no workouts row is a real zero; a
   *                day the phone never read is unknown, and unknown refunds.
   *                A covered day after the window is the proof it synced
   *                after the window closed.
   * sourceDays     days the phone reported anything on: covered days plus
   *                any day with a row (rows from a build before coverage).
   *                Tells the pass path "no sleep on a day the phone reported"
   *                (the device does not measure it) from "nothing synced yet".
   * partialDays    sleep days the phone flagged incomplete; never covered.
   * tzOffsetSec    the offset from the newest covered day that states one;
   *                null when none does, and then no miss can be recorded.
   */
  async getMissEvidence(
    address: string,
    metric: WearableMetric,
    fromISO: string,
  ): Promise<MissEvidence> {
    if (!appleProvider.metrics.includes(metric)) {
      throw new Error(
        `Apple Health cannot report ${metric}. Apple publishes no proprietary sleep score.`,
      );
    }
    // Up to one day past UTC today: a wearer east of Greenwich can honestly
    // have covered a local day that has not started in UTC.
    const to = daysAfter(isoDay(new Date()), 1);
    const [rows, covered, sourced] = await Promise.all([
      getDays(address, metric, fromISO, to),
      getCoveredDays(address, fromISO, to),
      getSourcedDays(address, fromISO, to),
    ]);

    const values: Record<string, number> = {};
    const partial: string[] = [];
    for (const row of rows) {
      values[row.day] = row.value;
      if (row.partial === true) partial.push(row.day);
    }

    const heartbeatDays = [...new Set(covered.map((c) => c.day))];
    const sourceDays = [...new Set([...heartbeatDays, ...sourced])];

    // iOS never tells an app whether Health read access was granted: a
    // denied sheet and an idle wearer both read as "covered, nothing found".
    // A phone that is syncing at all produces steps on its own, so a read
    // with no row of ANY metric is inconclusive, and the miss rule must
    // refund on it (source-unhealthy) rather than forfeit a workouts stake.
    // Sleep needs a value on every night regardless, so this only ever adds
    // caution.
    const sourceProblem =
      heartbeatDays.length > 0 && rows.length === 0 && sourced.size === 0
        ? "the phone covers days but has produced no Apple Health data of any kind; a denied Health permission cannot be told from an idle wearer"
        : null;

    // getCoveredDays answers newest day first; the first row that states an
    // offset is the wearer's current calendar.
    let tzOffsetSec: number | null = null;
    for (const day of covered) {
      if (day.tzOffsetSec !== null) {
        tzOffsetSec = day.tzOffsetSec;
        break;
      }
    }

    return {
      values,
      heartbeatDays,
      sourceDays,
      partialDays: partial,
      sourceProblem,
      tzOffsetSec,
    };
  },

  async getProgress(
    address: string,
    threshold: number,
    goalDays: number,
    windowStartISO?: string,
    windowEndISO?: string,
  ): Promise<WearableProgress> {
    // The dashboard card is a sleep card for every provider. The window is
    // widened backwards so baselineWeekAverage has its 8-14 days to work with,
    // and forwards to UTC tomorrow so a wearer east of Greenwich, whose
    // current local day has not started in UTC, is not read a night late.
    const today = isoDay(new Date());
    const end = windowEndISO ?? daysAfter(today, 1);
    const start = windowStartISO ?? daysBefore(today, Math.max(goalDays, 14) + 1);
    const readFrom = daysBefore(start, 14);
    const [rows, covered, sourced] = await Promise.all([
      getDays(address, "sleep_efficiency", readFrom, end),
      getCoveredDays(address, readFrom, end),
      getSourcedDays(address, readFrom, end),
    ]);
    const byDay = bestScorePerDay(
      rows.map((r) => ({ day: r.day, value: r.value })),
    );

    // Nights the phone REPORTED, scored or not. A covered day is the phone
    // reporting, whether or not a Watch produced a night: an iPhone with no
    // Watch covers every day and scores none, and that must read as "this
    // device sends no sleep data", not "awaiting first sync" for ever
    // (QA 2026-09-26). Days with any row count too, for rows written before
    // coverage existed.
    const reported = new Set<string>([
      ...byDay.keys(),
      ...covered.map((c) => c.day),
      ...sourced,
    ]);
    if (byDay.size === 0) {
      return { ...NO_PROGRESS, nightsReported: reported.size };
    }

    return {
      streakDays: countQualifyingDays(
        byDay,
        threshold,
        goalDays,
        windowStartISO,
        windowEndISO,
      ),
      baselineWeekAvg: baselineWeekAverage(byDay),
      days: daySeries(byDay),
      nightsReported: reported.size,
    };
  },

  async getRecent(address: string, days: number): Promise<WearableRecent> {
    // Through UTC tomorrow: last night in Tokyo is keyed to a local day that
    // is still tomorrow in UTC for nine hours after the wearer woke up.
    const today = isoDay(new Date());
    const end = daysAfter(today, 1);
    const start = daysBefore(today, Math.max(days, 1));
    const [score, hours, steps] = await Promise.all([
      getDays(address, "sleep_efficiency", start, end),
      getDays(address, "sleep_hours", start, end),
      getDays(address, "steps", start, end),
    ]);

    // Sleep score and sleep hours are separate rows for the same night, so the
    // card needs them merged back into one entry per day.
    const hoursByDay = new Map(hours.map((h) => [h.day, h.value]));
    const scoreByDay = new Map(score.map((s) => [s.day, s.value]));
    const sleepDays = [...new Set([...scoreByDay.keys(), ...hoursByDay.keys()])]
      .sort()
      .reverse();

    return {
      sleep: sleepDays.map((day) => ({
        date: day,
        score: scoreByDay.get(day) ?? null,
        hours: hoursByDay.get(day) ?? null,
      })),
      activity: steps.map((s) => ({ date: s.day, steps: s.value })),
    };
  },

  async disconnect(address: string): Promise<void> {
    // Apple CAN be disconnected, unlike Junction, because the data is ours to
    // delete. Deleting it also makes isConnected answer false again, so the
    // user is not left connected to something they asked us to forget.
    await deleteAllAppleData(address);
  },
};

// --------------------------------------------------------------- date helpers
//
// These compute the server's own read BOUNDS, in UTC, wide enough to include
// any wearer's local day: every open-ended read reaches to UTC today + 1,
// because a wearer at UTC+9 or beyond has a local day that UTC has not
// started. The day KEYS inside those bounds are the phone's local days as
// posted; nothing here re-keys them.

/** A YYYY-MM-DD key in streak.ts's format, from a UTC instant. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysBefore(isoDayStr: string, days: number): string {
  const d = new Date(`${isoDayStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return isoDay(d);
}

function daysAfter(isoDayStr: string, days: number): string {
  return daysBefore(isoDayStr, -days);
}
