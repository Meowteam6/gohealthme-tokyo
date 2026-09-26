// Junction (formerly Vital) health-data integration (server only).
//
// Replaces the WHOOP-direct OAuth integration with Junction's unified API,
// which covers WHOOP, Oura, Fitbit, Garmin, etc. through one connect flow.
// (Apple Health is intentionally NOT supported here: it requires Junction's
// native mobile SDK and cannot be linked from a web app.)
//
// Auth: header `x-vital-api-key`. Base URL + env/region come from env so the
// same code runs against sandbox or production.
//
// Privacy invariant (unchanged from WHOOP): raw samples never leave this
// module — only derived per-day scores and a streak summary are surfaced, and
// nothing here is written on-chain directly.
//
// Resilience: every request carries an AbortSignal timeout (a hung Junction
// call used to burn the whole 60s function budget) and GET reads retry with
// backoff. Writes never retry — creating a user or a link token twice is not a
// no-op. The wallet -> Junction user_id mapping is memoized because it sat on
// the hot path: getProgress/isConnected/getRecent each re-resolved it, so one
// 800ms poll cost three HTTP round-trips instead of one.

import { requireEnv, optionalEnv } from "@/lib/server/env";
import type { WearableMetric } from "@/lib/wearable-goal";
import type { MissEvidence } from "@/lib/server/wearable/types";
import { ttlCache } from "@/lib/server/arc-client";
import { isRetryableExternalError, withRetry } from "@/lib/server/retry";

/**
 * A hung upstream must fail well inside the function's 60s budget.
 * JUNCTION_TIMEOUT_MS overrides it (operator tuning, and tests that need to
 * exercise the timeout without waiting 15 seconds).
 */
const DEFAULT_JUNCTION_TIMEOUT_MS = 15_000;
const READ_ATTEMPTS = 2;
const READ_BACKOFF_MS = [300];

function junctionTimeoutMs(): number {
  const raw = Number(optionalEnv("JUNCTION_TIMEOUT_MS", ""));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_JUNCTION_TIMEOUT_MS;
}

function apiKey(): string {
  return requireEnv("JUNCTION_API_KEY");
}
function baseUrl(): string {
  return optionalEnv("JUNCTION_BASE_URL", "https://api.sandbox.tryvital.io");
}
function linkBase(): { env: string; region: string } {
  const env = optionalEnv("JUNCTION_ENV", "sandbox");
  const region = optionalEnv("JUNCTION_REGION", "us");
  return { env, region };
}

async function jxOnce<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${baseUrl()}${path}`, {
    ...init,
    headers: {
      "x-vital-api-key": apiKey(),
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(junctionTimeoutMs()),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    // Truncated: this message can surface through a route's error handler, so
    // it carries enough to debug without relaying an upstream response body.
    throw new Error(
      `Junction ${path} returned ${res.status}: ${text.slice(0, 200)}`,
    );
  }
  return (await res.json()) as T;
}

/**
 * Junction request. Retries only when the call is a read: a GET is idempotent,
 * a POST here creates a user or issues a link token and must run exactly once.
 */
async function jx<T>(path: string, init?: RequestInit): Promise<T> {
  const method = (init?.method ?? "GET").toUpperCase();
  if (method !== "GET") return jxOnce<T>(path, init);
  return withRetry(() => jxOnce<T>(path, init), {
    attempts: READ_ATTEMPTS,
    backoffMs: READ_BACKOFF_MS,
    isRetryable: isRetryableExternalError,
    onRetry: (err, attempt, attempts) =>
      console.warn(
        `[junction] GET ${path} attempt ${attempt}/${attempts} failed: ${
          err instanceof Error ? err.message : String(err)
        }`,
      ),
  });
}

// --------------------------------------------------------------- user mapping

interface VitalUser {
  user_id: string;
  client_user_id?: string;
}

/**
 * A wallet's Junction user_id never changes once created, but every
 * progress/status/data call re-resolved it, so a single 800ms dashboard poll
 * cost three HTTP round-trips where one would do. The TTL is short so a user
 * deleted upstream is not pinned forever, and failures are never cached.
 */
const USER_ID_TTL_MS = 10 * 60_000;
const userIdCache = ttlCache<string>({
  ttlMs: USER_ID_TTL_MS,
  maxEntries: 512,
});

/**
 * Map a wallet address to a Junction user_id. Junction itself keys on
 * client_user_id, so we resolve-then-create and let it dedupe — no local store
 * needed. The address is lowercased to keep the client_user_id stable.
 *
 * Memoized per address; concurrent callers share one in-flight resolve, so a
 * burst of polls cannot fan out into a burst of create attempts.
 */
export async function getOrCreateUser(address: string): Promise<string> {
  const clientUserId = address.toLowerCase();
  return userIdCache.get(clientUserId, async () => {
    // 1) resolve existing (idempotent read, so retried)
    try {
      const resolved = await withRetry(
        () =>
          jxOnce<VitalUser>(
            `/v2/user/resolve/${encodeURIComponent(clientUserId)}`,
          ),
        {
          attempts: READ_ATTEMPTS,
          backoffMs: READ_BACKOFF_MS,
          isRetryable: isRetryableExternalError,
        },
      );
      if (resolved.user_id) return resolved.user_id;
    } catch (err) {
      // A 404 here is the normal "not created yet" path, so this is expected
      // noise; anything else still falls through to the create below, which
      // Junction dedupes on client_user_id.
      console.warn(
        `[junction] user resolve fell through to create: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
    // 2) create — a write, so never retried.
    const created = await jx<VitalUser>("/v2/user", {
      method: "POST",
      body: JSON.stringify({ client_user_id: clientUserId }),
    });
    if (!created.user_id) {
      // Throw rather than return an empty id: the cache never stores a
      // rejected load, so a bad response cannot be pinned for the whole TTL.
      throw new Error("Junction created a user but returned no user_id");
    }
    return created.user_id;
  });
}

// ------------------------------------------------------------------ link flow

interface LinkTokenResponse {
  link_token: string;
}

/**
 * Create a Junction Link token + the hosted connect URL the browser opens to
 * link a provider (WHOOP/Oura/Fitbit/Garmin/…).
 */
export async function createLinkToken(
  address: string,
): Promise<{ userId: string; linkUrl: string }> {
  const userId = await getOrCreateUser(address);
  const { link_token } = await jx<LinkTokenResponse>("/v2/link/token", {
    method: "POST",
    body: JSON.stringify({ user_id: userId }),
  });
  const { env, region } = linkBase();
  const linkUrl = `https://link.tryvital.io/?token=${encodeURIComponent(
    link_token,
  )}&env=${env}&region=${region}`;
  return { userId, linkUrl };
}

// -------------------------------------------------------- mobile SDK sign-in

interface SignInTokenResponse {
  user_id?: string;
  sign_in_token?: string;
}

/**
 * Mint a short-lived Vital SDK sign-in token for a wallet's Junction user.
 *
 * The native mobile SDK (Apple Health on iOS, Health Connect on Android)
 * authenticates with this token instead of the API key, so JUNCTION_API_KEY
 * stays a server-side secret and never reaches the device. The token is scoped
 * to the SAME Junction user a wallet already maps to (client_user_id =
 * address.toLowerCase()), which is what makes the phone's HealthKit sync land
 * under the exact user the web verdict path reads from — one wallet, one health
 * identity across web and mobile.
 *
 * This mints an auth credential only: no raw health data is fetched or returned
 * here, so the privacy invariant at the top of this module is unchanged.
 */
export async function createSignInToken(
  address: string,
): Promise<{ userId: string; signInToken: string }> {
  const userId = await getOrCreateUser(address);
  // POST — a write that issues a fresh credential, so it runs exactly once (jx
  // only retries GETs). The endpoint takes no request body.
  const resp = await jx<SignInTokenResponse>(
    `/v2/user/${encodeURIComponent(userId)}/sign_in_token`,
    { method: "POST" },
  );
  if (!resp.sign_in_token) {
    // Throw rather than return an empty token: a caller must never treat a
    // missing credential as a usable one.
    throw new Error("Junction issued no sign_in_token for the user");
  }
  return { userId, signInToken: resp.sign_in_token };
}

// ---------------------------------------------------------- connection status

interface ProvidersResponse {
  providers: Array<{ slug?: string; status?: string }>;
}

// Provider statuses that mean the link exists on paper but will never yield
// data (revoked, mid-connect, expired token). A row in one of these states must
// not count as "connected", or the verdict path proceeds on a device that can
// only ever return an empty read and the user is told "goal not met" when the
// real state is "reconnect your device".
const UNUSABLE_PROVIDER_STATUS = new Set([
  "error",
  "disconnected",
  "paused",
  "expired",
  "unauthorized",
  "revoked",
]);

/** True once the user has at least one health-data provider in a usable state. */
export async function isConnected(address: string): Promise<boolean> {
  const userId = await getOrCreateUser(address);
  const { providers } = await jx<ProvidersResponse>(
    `/v2/user/providers/${userId}`,
  );
  if (!Array.isArray(providers)) return false;
  // A provider with no status field is treated as usable (some connectors omit
  // it); only an explicitly bad status disqualifies a row.
  return providers.some(
    (p) => !UNUSABLE_PROVIDER_STATUS.has((p.status ?? "").toLowerCase()),
  );
}

// -------------------------------------------------------------- progress feed

export interface JunctionProgress {
  streakDays: number;
  lastNight: number | null;
  qualified: boolean;
  /** Average score over days 8-14 back (the week before the current week). */
  baselineWeekAvg: number | null;
  /** Per-day scores used, newest first. */
  days: Array<{ date: string; score: number }>;
  /**
   * Nights the device reported at all, scored or not. `days` is empty and this
   * is non-zero for a tracker that syncs faithfully and produces no sleep
   * score - which must read as "does not measure this", never as "still
   * syncing", because waiting will not change it.
   */
  nightsReported: number;
}

interface SleepRecord {
  calendar_date?: string;
  date?: string;
  bedtime_stop?: string;
  score?: number | null;
  efficiency?: number | null;
  sleep_efficiency?: number | null;
  /** The wearer's UTC offset in seconds (Junction documents it on sleep). */
  timezone_offset?: number | null;
  /** long_sleep | short_sleep | acknowledged_nap | unknown (non-exhaustive). */
  type?: string | null;
  /** The device brand this summary came from ({ provider: "oura" }). */
  source?: { provider?: string | null } | null;
}

interface SleepResponse {
  sleep?: SleepRecord[];
  data?: SleepRecord[];
}

function dayKey(rec: SleepRecord): string | null {
  if (rec.calendar_date) return rec.calendar_date.slice(0, 10);
  if (rec.date) return rec.date.slice(0, 10);
  if (rec.bedtime_stop) return rec.bedtime_stop.slice(0, 10);
  return null;
}

/**
 * The night's proprietary sleep score, or null when the device does not
 * report one.
 *
 * Deliberately NOT falling back to efficiency: see the note on WearableMetric.
 * A night with no score is an unscored night, which the caller reports as
 * missing data rather than as a failure - it must never be dressed up as a
 * number the device never produced.
 */
function recScore(rec: SleepRecord): number | null {
  return typeof rec.score === "number" ? rec.score : null;
}

/** The night's sleep efficiency percentage, or null when absent. */
function recEfficiency(rec: SleepRecord): number | null {
  const v = rec.efficiency ?? rec.sleep_efficiency;
  return typeof v === "number" ? v : null;
}

/** One night's value for a sleep metric: score, efficiency, or hours asleep. */
function sleepMetricValue(
  rec: SleepRecord,
  metric: "sleep_score" | "sleep_efficiency" | "sleep_hours",
): number | null {
  if (metric === "sleep_score") return recScore(rec);
  if (metric === "sleep_efficiency") return recEfficiency(rec);
  const r = rec as SleepRecord & {
    total_sleep_seconds?: number;
    total?: number;
    duration?: number;
  };
  // Junction reports actual asleep time as `total` (seconds) and time in
  // bed as `duration`; prefer asleep so "sleep 7 hours" means 7 asleep.
  const secs = r.total_sleep_seconds ?? r.total ?? r.duration ?? null;
  return typeof secs === "number" ? secs / 3600 : null;
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Compute the current sleep streak for an address from Junction data.
 *
 * Mirrors the previous WHOOP logic: a day qualifies when its best sleep score
 * meets `threshold`; the streak is the run of consecutive calendar days ending
 * at the most recent scored night. baselineWeekAvg averages days 8-14 back,
 * feeding the comeback multiplier.
 */
export async function getProgress(
  address: string,
  threshold = 75,
  goalDays = 7,
  windowStartISO?: string,
  windowEndISO?: string,
): Promise<JunctionProgress> {
  const userId = await getOrCreateUser(address);
  const end = new Date();
  // Fetch enough history to cover either the rolling window or the pool period.
  const defaultStart = new Date(end.getTime() - 21 * 24 * 3600 * 1000);
  const start =
    windowStartISO !== undefined
      ? new Date(`${windowStartISO}T00:00:00Z`)
      : defaultStart;
  const resp = await jx<SleepResponse>(
    `/v2/summary/sleep/${userId}?start_date=${isoDate(start)}&end_date=${isoDate(end)}`,
  );
  const records = resp.sleep ?? resp.data ?? [];

  // Best score per calendar day.
  const byDay = new Map<string, number>();
  for (const rec of records) {
    const key = dayKey(rec);
    const score = recScore(rec);
    if (key === null || score === null) continue;
    const prev = byDay.get(key);
    if (prev === undefined || score > prev) byDay.set(key, score);
  }

  // Nights the device reported, whether or not they carried a score.
  const nightsReported = new Set(
    records.map((rec) => dayKey(rec)).filter((day) => day !== null),
  ).size;

  const dates = Array.from(byDay.keys()).sort().reverse(); // newest first
  if (dates.length === 0) {
    return {
      streakDays: 0,
      lastNight: null,
      qualified: false,
      baselineWeekAvg: null,
      days: [],
      nightsReported,
    };
  }

  const newest = dates[0];
  const lastNight = byDay.get(newest) ?? null;

  // Count qualifying days (score >= threshold). With a pool window we count
  // within [windowStart, min(windowEnd, today)] — progress scoped to the pool's
  // goal period (counting from when the goal started), not a rolling last-N.
  // Otherwise fall back to the last `goalDays`. Days over threshold are counted
  // rather than a strict consecutive run, so a single missing day of wearable
  // data doesn't reset progress.
  let streakDays = 0;
  if (windowStartISO !== undefined) {
    streakDays = windowDayCount(
      byDay,
      threshold,
      windowStartISO,
      windowEndISO,
    ).qualifyingDays;
  } else {
    const cursor = new Date(`${newest}T00:00:00Z`);
    for (let i = 0; i < goalDays; i += 1) {
      const key = cursor.toISOString().slice(0, 10);
      const score = byDay.get(key);
      if (score !== undefined && score >= threshold) streakDays += 1;
      cursor.setUTCDate(cursor.getUTCDate() - 1);
    }
  }

  // Baseline week: days 8..14 back from the newest night.
  const baselineScores: number[] = [];
  for (let back = 7; back < 14; back += 1) {
    const d = new Date(`${newest}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() - back);
    const score = byDay.get(d.toISOString().slice(0, 10));
    if (score !== undefined) baselineScores.push(score);
  }
  const baselineWeekAvg =
    baselineScores.length > 0
      ? baselineScores.reduce((a, b) => a + b, 0) / baselineScores.length
      : null;

  return {
    streakDays,
    lastNight,
    qualified: streakDays >= goalDays,
    baselineWeekAvg,
    days: dates.map((d) => ({ date: d, score: byDay.get(d) as number })),
    nightsReported,
  };
}

// -------------------------------------------------- goal-metric verdict feed

/**
 * The wearable metrics SPOTTER can verify a goal against. Each maps to a
 * specific Junction/Vital summary and a per-day field, so a steps goal is
 * judged on steps and a sleep goal on sleep - never one silently on the other.
 */
export type { WearableMetric } from "@/lib/wearable-goal";

/**
 * Per-window result for one metric. daysWithData === 0 means "connected but
 * nothing has synced for this period yet", which the verdict must treat as
 * sync-in-progress, NOT as a missed goal.
 */
export interface MetricProgress {
  qualifyingDays: number;
  /** Days inside the window that carried a value for THIS metric. */
  daysWithData: number;
  /**
   * Days inside the window the device reported ANYTHING for, whether or not it
   * carried this metric.
   *
   * This is what separates two states that look identical from daysWithData
   * alone and need opposite answers. Nothing at all means the device has not
   * synced yet and waiting fixes it. Records present but this metric absent
   * means the device does not measure it and waiting never fixes it - a
   * tracker with no sleep score will not grow one. Before this field, the
   * second case was reported as "give it a few minutes to sync" forever.
   */
  daysWithSource: number;
}

/**
 * Count days in [windowStart, min(windowEnd, today)] that have data and that
 * meet the threshold. Shared by the sleep-streak feed (getProgress) and the
 * metric feed (getMetricProgress).
 */
function windowDayCount(
  byDay: Map<string, number>,
  threshold: number,
  windowStartISO: string,
  windowEndISO?: string,
  sourceDays?: Set<string>,
  everyDaySourced = false,
): MetricProgress {
  const today = new Date();
  const winEnd =
    windowEndISO !== undefined && new Date(`${windowEndISO}T00:00:00Z`) < today
      ? new Date(`${windowEndISO}T00:00:00Z`)
      : today;
  const cur = new Date(`${windowStartISO}T00:00:00Z`);
  let qualifyingDays = 0;
  let daysWithData = 0;
  let daysWithSource = 0;
  while (cur <= winEnd) {
    const key = cur.toISOString().slice(0, 10);
    const v = byDay.get(key);
    if (v !== undefined) {
      daysWithData += 1;
      if (v >= threshold) qualifyingDays += 1;
    }
    // No source set means the caller cannot tell the two apart, so it reports
    // the metric's own days and the verdict falls back to the old reading.
    if (
      everyDaySourced ||
      (sourceDays === undefined ? v !== undefined : sourceDays.has(key))
    ) {
      daysWithSource += 1;
    }
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return { qualifyingDays, daysWithData, daysWithSource };
}

interface ActivityFields {
  calendar_date?: string;
  date?: string;
  steps?: number | null;
  calories_active?: number | null;
  active_calories?: number | null;
  calories?: number | null;
  distance?: number | null;
  distance_meters?: number | null;
  timezone_offset?: number | null;
  source?: { provider?: string | null } | null;
}
interface ActivitySummaryResponse {
  activity?: ActivityFields[];
  data?: ActivityFields[];
}
interface WorkoutRecord {
  calendar_date?: string;
  date?: string;
  time_start?: string;
  distance?: number | null;
  distance_meters?: number | null;
  timezone_offset?: number | null;
  source?: { provider?: string | null } | null;
}
interface WorkoutResponse {
  workouts?: WorkoutRecord[];
  data?: WorkoutRecord[];
}

function activityDay(rec: ActivityFields): string | null {
  return rec.calendar_date?.slice(0, 10) ?? rec.date?.slice(0, 10) ?? null;
}
function workoutDay(rec: WorkoutRecord): string | null {
  return (
    rec.calendar_date?.slice(0, 10) ??
    rec.date?.slice(0, 10) ??
    rec.time_start?.slice(0, 10) ??
    null
  );
}

/**
 * Fetch the right Junction/Vital summary for `metric` and reduce it to one
 * number per calendar day: best sleep score, longest sleep in hours, daily
 * steps or active calories, summed workout distance in km, or workout count.
 * Raw records never leave this function - only the derived per-day map does.
 */
async function fetchMetricByDay(
  userId: string,
  metric: WearableMetric,
  range: string,
): Promise<{
  byDay: Map<string, number>;
  sourceDays: Set<string>;
  /**
   * True for COUNT metrics, where a day with no record is a real zero rather
   * than missing data. Nobody worked out on Tuesday is an answer; the sleep
   * summary having no entry for Tuesday is not.
   */
  everyDaySourced: boolean;
}> {
  const byDay = new Map<string, number>();
  // Every day the device reported a record of the right KIND, whether or not
  // that record carried this metric. A tracker that syncs nightly but has no
  // sleep score lands here and not in byDay, which is what lets the verdict
  // say "your device does not measure this" instead of "still syncing".
  const sourceDays = new Set<string>();
  const seen = (day: string | null): void => {
    if (day !== null) sourceDays.add(day);
  };
  const keepMax = (day: string | null, value: number | null): void => {
    seen(day);
    if (day === null || value === null || !Number.isFinite(value)) return;
    const prev = byDay.get(day);
    if (prev === undefined || value > prev) byDay.set(day, value);
  };

  if (
    metric === "sleep_score" ||
    metric === "sleep_efficiency" ||
    metric === "sleep_hours"
  ) {
    const resp = await jx<SleepResponse>(`/v2/summary/sleep/${userId}?${range}`);
    for (const rec of resp.sleep ?? resp.data ?? []) {
      keepMax(dayKey(rec), sleepMetricValue(rec, metric));
    }
    return { byDay, sourceDays, everyDaySourced: false };
  }

  if (metric === "steps" || metric === "active_calories") {
    const resp = await jx<ActivitySummaryResponse>(
      `/v2/summary/activity/${userId}?${range}`,
    );
    for (const rec of resp.activity ?? resp.data ?? []) {
      const day = activityDay(rec);
      if (metric === "steps") {
        keepMax(day, typeof rec.steps === "number" ? rec.steps : null);
      } else {
        const cal =
          rec.calories_active ?? rec.active_calories ?? rec.calories ?? null;
        keepMax(day, typeof cal === "number" ? cal : null);
      }
    }
    return { byDay, sourceDays, everyDaySourced: false };
  }

  // distance_km and workouts both read the workouts summary: distance sums each
  // day's workout distance (km); workouts counts sessions per day.
  const resp = await jx<WorkoutResponse>(
    `/v2/summary/workouts/${userId}?${range}`,
  );
  for (const w of resp.workouts ?? resp.data ?? []) {
    const day = workoutDay(w);
    if (day === null) continue;
    seen(day);
    if (metric === "distance_km") {
      const meters = w.distance ?? w.distance_meters ?? null;
      const km = typeof meters === "number" ? meters / 1000 : 0;
      byDay.set(day, (byDay.get(day) ?? 0) + km);
    } else {
      byDay.set(day, (byDay.get(day) ?? 0) + 1);
    }
  }
  // A day with no workout means the person did not work out, which is a
  // verdict-worthy zero. Reporting it as missing data would tell somebody who
  // skipped the gym that their device is still syncing.
  return { byDay, sourceDays, everyDaySourced: true };
}

/**
 * Verdict-facing progress for an arbitrary wearable goal: fetch the metric the
 * goal is actually about and count qualifying days inside the pool period. This
 * is the fix for "every wearable pool judged on sleep" - the caller passes the
 * classified metric, and a steps goal is checked on steps.
 */
export async function getMetricProgress(
  address: string,
  metric: WearableMetric,
  threshold: number,
  windowStartISO: string,
  windowEndISO: string,
): Promise<MetricProgress> {
  const userId = await getOrCreateUser(address);
  const end = new Date();
  const start = new Date(`${windowStartISO}T00:00:00Z`);
  const range = `start_date=${isoDate(start)}&end_date=${isoDate(end)}`;
  const { byDay, sourceDays, everyDaySourced } = await fetchMetricByDay(
    userId,
    metric,
    range,
  );
  return windowDayCount(
    byDay,
    threshold,
    windowStartISO,
    windowEndISO,
    sourceDays,
    everyDaySourced,
  );
}

// ------------------------------------------------------- miss-rule evidence

/** Junction's sleep types (non-exhaustive enum): >=3h main sleep, <3h sleep,
 *  a nap the wearer acknowledged, and a recording still in progress. */
const MAIN_SLEEP = "long_sleep";

/** The source (device brand) a summary record came from, or null. */
function sourceOf(rec: { source?: { provider?: string | null } | null }): string | null {
  const provider = rec.source?.provider;
  return typeof provider === "string" && provider.length > 0 ? provider.toLowerCase() : null;
}

/**
 * Per-local-day evidence for the miss rule (lib/server/agent/miss.ts) and the
 * pass path (runProgress), from `fromISO` to today. Junction's calendar_date
 * is the wearer's own calendar day (for sleep, "generally the sleep end
 * date"), so nothing is re-keyed.
 *
 * Sleep. Values: the best value of any sleep that day, as the pass path always
 * read it; for hours, the sum of that day's main sleeps when it is larger, so
 * a night split in two counts whole. A day is PARTIAL (never covered for a
 * miss) unless it holds a main sleep (type long_sleep) and nothing else that
 * could be part of the night: a nap-only day, a short sleep beside the main
 * one, a recording still in progress, or a record with no type at all.
 *
 * Workouts. Values: sessions per day. The heartbeat is the SOURCE THAT
 * RECORDS WORKOUTS, not any record: an Oura ring's nightly sleep proves
 * nothing about whether Strava synced. That source is the one every workout
 * in the read came from, or the only linked source when there is no workout
 * yet; more than one, or none that can be told, is a sourceProblem, and so is
 * any linked source in an unusable state. A record with no source counts only
 * when exactly one source is linked.
 *
 * The offset is the newest record's timezone_offset (seconds), sleep first;
 * none means null. Throws on any upstream failure, like every read here; the
 * miss rule turns a throw into "record nothing".
 */
export async function getMissEvidence(
  address: string,
  metric: WearableMetric,
  fromISO: string,
): Promise<MissEvidence> {
  const sleepMetric =
    metric === "sleep_score" ||
    metric === "sleep_efficiency" ||
    metric === "sleep_hours";
  if (!sleepMetric && metric !== "workouts") {
    throw new Error(
      `miss evidence covers sleep and workouts only, not ${metric}: a zero there is ambiguous`,
    );
  }
  const userId = await getOrCreateUser(address);
  const range = `start_date=${fromISO}&end_date=${isoDate(new Date())}`;
  const sleepResp = await jx<SleepResponse>(`/v2/summary/sleep/${userId}?${range}`);
  const sleeps = sleepResp.sleep ?? sleepResp.data ?? [];

  const tzFrom = (
    activity: ActivityFields[],
    workouts: WorkoutRecord[],
  ): number | null =>
    newestOffset(sleeps, dayKey) ??
    newestOffset(activity, activityDay) ??
    newestOffset(workouts, workoutDay);

  if (sleepMetric) {
    const values: Record<string, number> = {};
    const mainSum: Record<string, number> = {};
    const sourceDays = new Set<string>();
    const hasMain = new Set<string>();
    const hasOther = new Set<string>();
    for (const rec of sleeps) {
      const day = dayKey(rec);
      if (day === null) continue;
      sourceDays.add(day);
      if (rec.type === MAIN_SLEEP) hasMain.add(day);
      else hasOther.add(day);
      const value = sleepMetricValue(rec, metric);
      if (value === null || !Number.isFinite(value)) continue;
      if (values[day] === undefined || value > values[day]) values[day] = value;
      if (metric === "sleep_hours" && rec.type === MAIN_SLEEP) {
        mainSum[day] = (mainSum[day] ?? 0) + value;
      }
    }
    for (const [day, sum] of Object.entries(mainSum)) {
      if (sum > (values[day] ?? 0)) values[day] = sum;
    }
    const partialDays = [...sourceDays].filter(
      (day) => !hasMain.has(day) || hasOther.has(day),
    );
    return {
      values,
      heartbeatDays: [...sourceDays],
      sourceDays: [...sourceDays],
      partialDays,
      tzOffsetSec: tzFrom([], []),
    };
  }

  const [actResp, workResp, linked] = await Promise.all([
    jx<ActivitySummaryResponse>(`/v2/summary/activity/${userId}?${range}`),
    jx<WorkoutResponse>(`/v2/summary/workouts/${userId}?${range}`),
    jx<ProvidersResponse>(`/v2/user/providers/${userId}`),
  ]);
  const activity = actResp.activity ?? actResp.data ?? [];
  const workouts = workResp.workouts ?? workResp.data ?? [];
  const providers = Array.isArray(linked.providers) ? linked.providers : [];

  const values: Record<string, number> = {};
  for (const rec of workouts) {
    const day = workoutDay(rec);
    if (day !== null) values[day] = (values[day] ?? 0) + 1;
  }

  let sourceProblem: string | null = null;
  const unusable = providers.filter((p) =>
    UNUSABLE_PROVIDER_STATUS.has((p.status ?? "").toLowerCase()),
  );
  if (unusable.length > 0) {
    sourceProblem = `linked source ${unusable
      .map((p) => `${p.slug ?? "unknown"} is ${p.status}`)
      .join(", ")}`;
  }
  const linkedSlugs = providers
    .filter((p) => !UNUSABLE_PROVIDER_STATUS.has((p.status ?? "").toLowerCase()))
    .map((p) => (p.slug ?? "").toLowerCase())
    .filter((slug) => slug.length > 0);
  const onlyLinked = linkedSlugs.length === 1 ? linkedSlugs[0] : null;
  const workoutSources = new Set(
    workouts
      .map((rec) => sourceOf(rec) ?? onlyLinked)
      .filter((source): source is string => source !== null),
  );
  let workoutSource: string | null = null;
  if (workoutSources.size === 1) {
    workoutSource = [...workoutSources][0];
  } else if (workouts.length === 0 && onlyLinked !== null) {
    workoutSource = onlyLinked;
  }
  if (workoutSource === null) {
    sourceProblem ??=
      workoutSources.size > 1
        ? `workouts come from more than one source (${[...workoutSources].join(", ")})`
        : "cannot tell which linked source records workouts";
  }

  const heartbeat = new Set<string>();
  const beat = (
    day: string | null,
    rec: { source?: { provider?: string | null } | null },
  ): void => {
    if (day === null || workoutSource === null) return;
    if ((sourceOf(rec) ?? onlyLinked) === workoutSource) heartbeat.add(day);
  };
  sleeps.forEach((rec) => beat(dayKey(rec), rec));
  activity.forEach((rec) => beat(activityDay(rec), rec));
  workouts.forEach((rec) => beat(workoutDay(rec), rec));

  return {
    values,
    heartbeatDays: [...heartbeat],
    sourceDays: [...heartbeat],
    sourceProblem,
    tzOffsetSec: tzFrom(activity, workouts),
  };
}

/** The timezone_offset of the newest record that carries one, or null. */
function newestOffset<T extends { timezone_offset?: number | null }>(
  records: T[],
  dayOf: (rec: T) => string | null,
): number | null {
  let best: { day: string; offset: number } | null = null;
  for (const rec of records) {
    if (typeof rec.timezone_offset !== "number") continue;
    const day = dayOf(rec) ?? "";
    if (best === null || day > best.day) best = { day, offset: rec.timezone_offset };
  }
  return best?.offset ?? null;
}

// ------------------------------------------------------------- recent data

export interface RecentData {
  sleep: Array<{ date: string; score: number | null; hours: number | null }>;
  activity: Array<{ date: string; steps: number | null }>;
}

interface ActivityRecord {
  calendar_date?: string;
  date?: string;
  steps?: number | null;
}
interface ActivityResponse {
  activity?: ActivityRecord[];
  data?: ActivityRecord[];
}

/**
 * Recent per-day sleep + activity, newest first, for the dashboard demo
 * display once a provider is linked. Each summary call is best-effort so a
 * provider that only reports one modality still renders the other.
 */
export async function getRecent(address: string, days = 7): Promise<RecentData> {
  const userId = await getOrCreateUser(address);
  const end = new Date();
  const start = new Date(end.getTime() - days * 24 * 3600 * 1000);
  const range = `start_date=${isoDate(start)}&end_date=${isoDate(end)}`;

  const [sleepResp, actResp] = await Promise.all([
    jx<SleepResponse>(`/v2/summary/sleep/${userId}?${range}`).catch(
      () => ({ sleep: [] }) as SleepResponse,
    ),
    jx<ActivityResponse>(`/v2/summary/activity/${userId}?${range}`).catch(
      () => ({ activity: [] }) as ActivityResponse,
    ),
  ]);

  const sleepRecs = sleepResp.sleep ?? sleepResp.data ?? [];
  const actRecs = actResp.activity ?? actResp.data ?? [];

  const sleep = sleepRecs
    .map((r) => {
      const date = dayKey(r);
      if (date === null) return null;
      const rec = r as SleepRecord & {
        duration?: number;
        total_sleep_seconds?: number;
      };
      const secs = rec.total_sleep_seconds ?? rec.duration ?? null;
      return {
        date,
        score: recScore(r),
        hours:
          typeof secs === "number" ? Math.round((secs / 3600) * 10) / 10 : null,
      };
    })
    .filter(
      (x): x is { date: string; score: number | null; hours: number | null } =>
        x !== null,
    )
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  const activity = actRecs
    .map((r) => {
      const date =
        r.calendar_date?.slice(0, 10) ?? r.date?.slice(0, 10) ?? null;
      if (date === null) return null;
      return { date, steps: typeof r.steps === "number" ? r.steps : null };
    })
    .filter((x): x is { date: string; steps: number | null } => x !== null)
    .sort((a, b) => (a.date < b.date ? 1 : -1));

  return { sleep, activity };
}
