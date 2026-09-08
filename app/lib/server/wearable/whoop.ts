// WHOOP API v2, direct (server only).
//
// The alternative to the Junction path. Junction is a paid intermediary that
// holds the user mapping for us; WHOOP-direct is free, first-party, and holds
// nothing on our behalf - which means we hold the OAuth tokens, and every
// consequence of that lands in this file and in tokens.ts.
//
// ENDPOINTS, verified against WHOOP's maintained OSS integration surface:
//   authorize  https://api.prod.whoop.com/oauth/oauth2/auth
//   token      https://api.prod.whoop.com/oauth/oauth2/token
//   api base   https://api.prod.whoop.com/developer
//   sleep      GET /v2/activity/sleep?start&end&limit&nextToken  (limit max 25)
//   profile    GET /v2/user/profile/basic
//   revoke     DELETE /v2/user/access
// No PKCE (WHOOP does not require it); client credentials go in the token
// request BODY, not a Basic header.
//
// WE DO NOT KEEP WHOOP DATA. WHOOP's API Terms forbid building databases or
// permanent copies of WHOOP Data, with cached copies bounded by the response
// cache header. So every read here is live and nothing derived from a sleep
// record is written to any store: the streak is computed in memory, returned,
// and dropped. The only thing persisted for a WHOOP user is their OAuth token
// record. This is also why there is no local sleep cache to make the dashboard
// faster - that cache would be the violation.
//
// REVOCATION IS SILENT. WHOOP has no de-authorization webhook: a user who
// disconnects us inside the WHOOP app generates no notification, and the first
// we learn of it is a refused refresh. That is why refresh failures are
// classified rather than merely retried - a revoked user must be told to
// re-link, not shown a provider-outage message they cannot act on.
//
// PRIVACY INVARIANT: raw sleep records never leave this module. Only per-day
// scores, counts and labels cross the boundary, and nothing here goes on-chain.

import { optionalEnv, requireEnv } from "@/lib/server/env";
import { isRetryableExternalError } from "@/lib/server/retry";
import {
  clearTokens,
  readTokens,
  withTokenLock,
  type StoredTokens,
} from "@/lib/server/wearable/tokens";
import {
  baselineWeekAverage,
  bestScorePerDay,
  countQualifyingDays,
  daySeries,
} from "@/lib/server/wearable/streak";
import type {
  MetricProgress,
  WearableLink,
  WearableMetric,
  WearableProgress,
  WearableProvider,
  WearableRecent,
} from "@/lib/server/wearable/types";

const AUTHORIZE_URL = "https://api.prod.whoop.com/oauth/oauth2/auth";
const TOKEN_URL = "https://api.prod.whoop.com/oauth/oauth2/token";
const API_BASE = "https://api.prod.whoop.com/developer";

/**
 * What the app asks WHOOP for, and why it is not narrower.
 *
 * The first version asked for sleep alone, on a least-privilege argument. That
 * was the wrong call: every metric a provider declines is a pool its users
 * cannot join, and declining workouts and calories was a scope decision, not a
 * physical limit. A user who is told "your device cannot verify this" about
 * something their device measures perfectly well is being failed by us, not by
 * their strap.
 *
 * The privacy claim survives, and it is now a stronger one because it is about
 * behaviour rather than about the grant: a read only ever calls the endpoint
 * the pool's own metric requires, so a sleep pool reads sleep and nothing
 * else. Body measurement and profile scopes stay unrequested - nothing in the
 * product measures a goal against them. read:cycles is also unrequested: see
 * WHOOP_METRICS for why cycle energy cannot honestly answer a calories goal.
 *
 * `offline` is what makes WHOOP issue a refresh token, required because
 * verification runs on a cron long after the user has left the browser.
 */
const SCOPES = "read:sleep read:workout offline";

/** WHOOP's page size ceiling for collection endpoints. */
const PAGE_LIMIT = 25;
/** Two pages of 25 nights covers the 21-day lookback with room to spare. */
const MAX_PAGES = 2;
/** Lookback for progress reads with no explicit window, in days. */
const DEFAULT_LOOKBACK_DAYS = 21;

const DEFAULT_TIMEOUT_MS = 15_000;
/** Refresh this far before expiry, so a slow request cannot 401 mid-flight. */
const REFRESH_MARGIN_MS = 60_000;

function timeoutMs(): number {
  const raw = Number(optionalEnv("WHOOP_TIMEOUT_MS", ""));
  return Number.isFinite(raw) && raw > 0 ? raw : DEFAULT_TIMEOUT_MS;
}

function clientId(): string {
  return requireEnv("WHOOP_CLIENT_ID");
}

function clientSecret(): string {
  return requireEnv("WHOOP_CLIENT_SECRET");
}

function redirectUri(): string {
  return requireEnv("WHOOP_REDIRECT_URI");
}

/** Whether the WHOOP path is configured at all. */
export function whoopConfigured(): boolean {
  for (const name of [
    "WHOOP_CLIENT_ID",
    "WHOOP_CLIENT_SECRET",
    "WHOOP_REDIRECT_URI",
  ]) {
    const value = process.env[name];
    if (value === undefined || value.trim() === "") return false;
  }
  return true;
}

// ------------------------------------------------------------------ failures

/**
 * WHOOP has refused this user specifically, and no retry or wait will help:
 * they revoked access, or the refresh token has been spent or expired. The
 * only recovery is a fresh authorization, so this is surfaced as "not
 * connected" rather than as an outage.
 */
export class WhoopReauthorizationRequired extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhoopReauthorizationRequired";
  }
}

/**
 * This provider cannot measure the metric a goal is about. Not an outage and
 * not the user's fault: the device simply does not report it.
 */
export class WhoopMetricUnsupported extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhoopMetricUnsupported";
  }
}

/**
 * A data call came back 401. Ambiguous on purpose: WHOOP's 401 body is
 * byte-identical for an expired token, a malformed token and a revoked grant,
 * so this is never surfaced to a caller - whoopGet resolves it into either a
 * successful retry or WhoopReauthorizationRequired.
 */
class WhoopUnauthorized extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WhoopUnauthorized";
  }
}

// ---------------------------------------------------------------- oauth flow

/** The authorize URL to send the browser to. `state` must be at least 8 chars. */
export function buildAuthorizeUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: clientId(),
    redirect_uri: redirectUri(),
    response_type: "code",
    scope: SCOPES,
    state,
  });
  return `${AUTHORIZE_URL}?${params.toString()}`;
}

interface TokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
  scope: string;
}

/**
 * A 400 from the token endpoint means the grant itself is bad - an expired
 * code, or a refresh token that has already been rotated away. WHOOP reports
 * it as an OAuth error body, and it must not be retried: repeating a spent
 * grant produces the same 400 three times and delays telling the user to
 * re-link.
 */
function isGrantFailure(status: number): boolean {
  return status === 400 || status === 401;
}

async function requestToken(
  body: URLSearchParams,
  context: string,
): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    signal: AbortSignal.timeout(timeoutMs()),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = text.slice(0, 200);
    if (isGrantFailure(res.status)) {
      throw new WhoopReauthorizationRequired(
        `WHOOP ${context} was refused (${res.status}): ${detail}`,
      );
    }
    throw new Error(
      `WHOOP /oauth/oauth2/token returned ${res.status}: ${detail}`,
    );
  }
  return (await res.json()) as TokenResponse;
}

function tokensFrom(data: TokenResponse): Omit<StoredTokens, "updatedAt"> {
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + data.expires_in * 1000,
    scope: data.scope,
  };
}

/** Exchange an authorization code. Called once, from the callback route. */
export async function exchangeCode(
  code: string,
): Promise<Omit<StoredTokens, "updatedAt">> {
  const data = await requestToken(
    new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: clientId(),
      client_secret: clientSecret(),
      redirect_uri: redirectUri(),
    }),
    "authorization code exchange",
  );
  return tokensFrom(data);
}

/**
 * Spend a refresh token for a new pair.
 *
 * WHOOP rotates the refresh token on every refresh and invalidates the old
 * access token as it does, so this must run exactly once per rotation - which
 * is why every caller reaches it through withTokenLock, never directly.
 */
async function refreshTokens(
  current: StoredTokens,
): Promise<Omit<StoredTokens, "updatedAt">> {
  const data = await requestToken(
    new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: current.refreshToken,
      client_id: clientId(),
      client_secret: clientSecret(),
      scope: "offline",
    }),
    "token refresh",
  );
  return tokensFrom(data);
}

/**
 * A usable access token for this wallet, refreshing under lock when it is
 * close to expiry. Throws WhoopReauthorizationRequired when the wallet has
 * never linked, or when WHOOP has refused the refresh - the caller turns that
 * into "not connected", not into an outage.
 *
 * The refresh happens inside the lock and re-reads the record first, so a
 * request that queued behind another request's refresh picks up the token that
 * refresh just wrote instead of spending the rotated-away one.
 */
async function accessTokenFor(address: string): Promise<string> {
  const existing = await readTokens("whoop", address);
  if (existing === null) {
    throw new WhoopReauthorizationRequired(
      `No WHOOP connection stored for ${address.toLowerCase()}.`,
    );
  }
  if (existing.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
    return existing.accessToken;
  }

  return withTokenLock("whoop", address, async (current) => {
    if (current === null) {
      throw new WhoopReauthorizationRequired(
        `No WHOOP connection stored for ${address.toLowerCase()}.`,
      );
    }
    // Another request may have refreshed while we waited for the lock.
    if (current.expiresAt - REFRESH_MARGIN_MS > Date.now()) {
      return { tokens: null, result: current.accessToken };
    }
    try {
      const refreshed = await refreshTokens(current);
      return { tokens: refreshed, result: refreshed.accessToken };
    } catch (err) {
      if (err instanceof WhoopReauthorizationRequired) {
        // The grant is dead. Keeping the record would make every later read
        // repeat this failed refresh and report an outage forever, so the
        // connection is dropped and the user is asked to link again.
        await clearTokens("whoop", address);
      }
      throw err;
    }
  });
}

/**
 * Spend a refresh regardless of the recorded expiry, because WHOOP just
 * rejected the access token we hold.
 *
 * Under the same lock as the scheduled refresh, and it re-reads first: if
 * another request already refreshed while this one waited, that newer token is
 * returned instead of rotating away a perfectly good grant. The `since` guard
 * is what makes that check meaningful - a record written after we read the
 * token that failed is by definition newer than the failure.
 */
async function forceRefresh(address: string): Promise<string> {
  const failedAt = Date.now();
  return withTokenLock("whoop", address, async (current) => {
    if (current === null) {
      throw new WhoopReauthorizationRequired(
        `No WHOOP connection stored for ${address.toLowerCase()}.`,
      );
    }
    if (current.updatedAt > failedAt) {
      return { tokens: null, result: current.accessToken };
    }
    try {
      const refreshed = await refreshTokens(current);
      return { tokens: refreshed, result: refreshed.accessToken };
    } catch (err) {
      if (err instanceof WhoopReauthorizationRequired) {
        await clearTokens("whoop", address);
      }
      throw err;
    }
  });
}

// ------------------------------------------------------------------- api read

/** WHOOP answered 429. `resetSeconds` is how long until the window rolls. */
class WhoopRateLimited extends Error {
  readonly resetSeconds: number;
  constructor(path: string, resetSeconds: number) {
    super(`WHOOP ${path} returned 429: rate limited`);
    this.name = "WhoopRateLimited";
    this.resetSeconds = resetSeconds;
  }
}

/** Longest we will sit on a rate-limit reset before giving up on the read. */
const MAX_RATE_LIMIT_WAIT_MS = 5_000;
/** Backoff for a transient failure that is not a rate limit. */
const TRANSIENT_BACKOFF_MS = 300;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Seconds until the rate-limit window rolls over. WHOOP documents
 * X-RateLimit-Reset and does NOT document Retry-After, so Retry-After is
 * honoured when present and the documented header is the fallback.
 */
function resetSecondsOf(res: Response): number {
  for (const header of ["retry-after", "x-ratelimit-reset"]) {
    const raw = res.headers.get(header);
    if (raw === null) continue;
    const seconds = Number(raw);
    if (Number.isFinite(seconds) && seconds >= 0) return seconds;
  }
  return 1;
}

async function whoopGetOnce<T>(
  token: string,
  path: string,
  params?: URLSearchParams,
): Promise<T> {
  const query = params === undefined ? "" : `?${params.toString()}`;
  const res = await fetch(`${API_BASE}${path}${query}`, {
    headers: { authorization: `Bearer ${token}` },
    // WHOOP forbids permanent copies of its data, so nothing here may be
    // served from, or written to, a cache.
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs()),
  });

  if (res.status === 429) {
    throw new WhoopRateLimited(path, resetSecondsOf(res));
  }

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    const detail = text.slice(0, 200);
    if (res.status === 401) {
      // NOT proof of revocation. WHOOP returns a byte-identical 401 body for
      // an expired token, a malformed token and a revoked grant, so this says
      // only "this access token did not work". The caller decides which it was
      // by trying a refresh - the token endpoint is the only surface that
      // distinguishes them.
      throw new WhoopUnauthorized(`WHOOP ${path} returned 401: ${detail}`);
    }
    // House upstream-error format: "<provider> <path> returned <status>:
    // <body>", which lib/wearable-provider.ts parses to tell an outage apart
    // from a credential problem, and isRetryableExternalError reads to decide
    // whether another attempt is worth it.
    throw new Error(`WHOOP ${path} returned ${res.status}: ${detail}`);
  }

  return (await res.json()) as T;
}

/**
 * Read from WHOOP, handling the two failure modes that need more than a
 * generic retry.
 *
 * A 401 is ambiguous by design (see above), so the response is to spend a
 * refresh and try once more: if the refresh succeeds the 401 was just an
 * expired access token, and if it comes back invalid_grant the user really has
 * revoked us and must link again. This is the ONLY way to detect revocation -
 * WHOOP publishes no de-authorization webhook.
 *
 * A 429 is answered by waiting the window out rather than by fixed backoff,
 * because the limit is per API KEY and not per user: at 100 requests a minute
 * shared across everyone, guessing the wait means either failing a claim early
 * or holding a serverless function open for nothing.
 *
 * Deliberately not withRetry: neither of those behaviours can be expressed as
 * a fixed backoff array, and stacking a second retry policy on top would
 * multiply the worst-case wall clock past the function budget.
 */
async function whoopGet<T>(
  address: string,
  path: string,
  params?: URLSearchParams,
): Promise<T> {
  let token = await accessTokenFor(address);
  let refreshed = false;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await whoopGetOnce<T>(token, path, params);
    } catch (err) {
      if (err instanceof WhoopUnauthorized) {
        if (refreshed) {
          // A freshly minted token was rejected too. Something is wrong that
          // another attempt cannot fix, and re-linking is the honest ask.
          throw new WhoopReauthorizationRequired(
            `WHOOP rejected a freshly refreshed token for ${path}. ` +
              "The connection needs to be re-authorized.",
          );
        }
        refreshed = true;
        // Throws WhoopReauthorizationRequired when the grant is dead, which
        // is what turns a revoked user into "connect a device" rather than
        // into an outage they cannot act on.
        token = await forceRefresh(address);
        continue;
      }

      if (err instanceof WhoopRateLimited) {
        const waitMs = Math.min(
          err.resetSeconds * 1000,
          MAX_RATE_LIMIT_WAIT_MS,
        );
        if (attempt === 2 || waitMs >= MAX_RATE_LIMIT_WAIT_MS) {
          throw new Error(
            `WHOOP ${path} returned 429: rate limited, resets in ` +
              `${err.resetSeconds}s`,
          );
        }
        console.warn(
          `[whoop] GET ${path} rate limited, waiting ${waitMs}ms`,
        );
        await sleep(waitMs);
        continue;
      }

      if (attempt < 2 && isRetryableExternalError(err)) {
        console.warn(
          `[whoop] GET ${path} attempt ${attempt + 1} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
        await sleep(TRANSIENT_BACKOFF_MS);
        continue;
      }

      throw err;
    }
  }

  throw new Error(`WHOOP ${path} exhausted its attempts`);
}

// --------------------------------------------------------------- sleep record

interface SleepRecord {
  id?: string | number;
  start?: string;
  end?: string;
  nap?: boolean;
  score_state?: string;
  score?: {
    sleep_performance_percentage?: number | null;
    sleep_efficiency_percentage?: number | null;
    stage_summary?: {
      total_in_bed_time_milli?: number | null;
      total_awake_time_milli?: number | null;
    } | null;
  } | null;
}

interface SleepPage {
  records?: SleepRecord[];
  next_token?: string | null;
}

/**
 * The night's sleep score. WHOOP's sleep performance percentage is the number
 * that corresponds to Junction's sleep score, so a pool threshold means the
 * same thing on both paths.
 *
 * It does NOT fall back to efficiency. Efficiency is a different measurement
 * on the same 0-100 scale - asleep over in-bed, typically 85-95 - and
 * substituting it would hold this user to a materially easier bar than a user
 * whose device reported a real score, for the same stake and the same payout.
 * A night WHOOP did not score is an unscored night, reported as missing data.
 */
function scoreOf(record: SleepRecord): number | null {
  const performance = record.score?.sleep_performance_percentage;
  return typeof performance === "number" ? performance : null;
}

/** The night's sleep efficiency percentage, or null when absent. */
function efficiencyOf(record: SleepRecord): number | null {
  const efficiency = record.score?.sleep_efficiency_percentage;
  return typeof efficiency === "number" ? efficiency : null;
}

/**
 * The calendar day a night belongs to: the day the sleep ENDED. A night that
 * starts at 23:40 on the 3rd and ends at 07:10 on the 4th is the 4th's sleep,
 * which is how a person reads their own week and how Junction assigns it.
 */
function dayOf(record: SleepRecord): string | null {
  return typeof record.end === "string" && record.end.length >= 10
    ? record.end.slice(0, 10)
    : null;
}

/** Only a scored main sleep counts. Naps and pending scores are skipped. */
function isCountable(record: SleepRecord): boolean {
  return record.nap !== true && record.score_state === "SCORED";
}

/**
 * Walk a WHOOP collection endpoint. Every one of them pages the same way:
 * start/end/limit in, { records, next_token } out, 25 records a page.
 *
 * Bounded by MAX_PAGES rather than draining the collection, because the rate
 * limit is 10000 requests a DAY across every user of this app. An unbounded
 * walk on one wallet is an outage for everyone else.
 */
async function fetchPaged<TRecord, TPage extends { records?: TRecord[]; next_token?: string | null }>(
  address: string,
  path: string,
  startISO: string,
  endISO: string,
): Promise<TRecord[]> {
  const records: TRecord[] = [];
  let nextToken: string | undefined;

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const params = new URLSearchParams({
      start: startISO,
      end: endISO,
      limit: String(PAGE_LIMIT),
    });
    if (nextToken !== undefined) params.set("nextToken", nextToken);

    const data = await whoopGet<TPage>(address, path, params);
    const pageRecords = data.records ?? [];
    records.push(...pageRecords);
    if (pageRecords.length === 0) break;
    if (data.next_token === undefined || data.next_token === null) break;
    nextToken = data.next_token;
  }

  return records;
}

function fetchSleep(
  address: string,
  startISO: string,
  endISO: string,
): Promise<SleepRecord[]> {
  return fetchPaged<SleepRecord, SleepPage>(
    address,
    "/v2/activity/sleep",
    startISO,
    endISO,
  );
}

/** Best score per calendar day over a window, from live WHOOP data only. */
async function scoresByDay(
  address: string,
  startISO: string,
  endISO: string,
): Promise<Map<string, number>> {
  const records = await fetchSleep(address, startISO, endISO);
  return bestScorePerDay(
    records
      .filter(isCountable)
      .map((record) => ({ day: dayOf(record), value: scoreOf(record) })),
  );
}

function rfc3339(date: Date): string {
  return date.toISOString();
}

function startOfDayUTC(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00Z`);
}

/**
 * Hours actually asleep: time in bed less time awake.
 *
 * In-bed time alone would credit somebody for lying there at 3am, which is the
 * opposite of what a sleep-hours goal is asking for.
 */
function sleepHoursOf(record: SleepRecord): number | null {
  const inBed = record.score?.stage_summary?.total_in_bed_time_milli;
  if (typeof inBed !== "number") return null;
  const awake = record.score?.stage_summary?.total_awake_time_milli;
  const asleep = inBed - (typeof awake === "number" ? awake : 0);
  return asleep > 0 ? asleep / 3_600_000 : 0;
}

/**
 * What a WHOOP strap can honestly answer.
 *
 * Declared rather than discovered: a read that quietly returned zero for a
 * metric the device cannot measure would tell somebody who walked 12,000 steps
 * that they missed their goal and pay them nothing. The pool list uses this
 * list to refuse the mismatch before anyone stakes.
 *
 * WHAT IS DELIBERATELY ABSENT, AND WHY - each of these is a semantic limit, not
 * a scope we were too lazy to request:
 *
 *   steps           A WHOOP strap has no pedometer. There is no number to read.
 *
 *   distance_km     Workouts carry `score.distance_meter`, so a recorded run
 *                   would answer. Daily walking distance would not, because
 *                   nothing outside a recorded workout is measured. Serving it
 *                   would pass a runner and silently fail a walker on the same
 *                   goal, which is worse than declining it.
 *
 *   active_calories WHOOP reports `kilojoule` on the cycle, and that is TOTAL
 *                   energy expenditure including basal metabolism - roughly
 *                   2500 kcal a day for an adult who did nothing. Junction's
 *                   number is ACTIVE calories, a few hundred. Reporting one as
 *                   the other would clear a 500-calorie goal every day of the
 *                   week without the user moving. This is the same defect as
 *                   substituting sleep efficiency for a sleep score, and it is
 *                   refused for the same reason.
 */
const WHOOP_METRICS: readonly WearableMetric[] = [
  "sleep_score",
  "sleep_efficiency",
  "sleep_hours",
  "workouts",
];

/** The per-day value for a sleep metric WHOOP can actually serve. */
function sleepMetricValueOf(
  record: SleepRecord,
  metric: WearableMetric,
): number | null {
  if (metric === "sleep_hours") return sleepHoursOf(record);
  if (metric === "sleep_efficiency") return efficiencyOf(record);
  return scoreOf(record);
}

interface WorkoutRecord {
  start?: string;
  end?: string;
  score_state?: string;
}

interface WorkoutPage {
  records?: WorkoutRecord[];
  next_token?: string | null;
}

/**
 * Workouts per calendar day, counted the way Junction counts them: a session
 * belongs to the day it ended, and the day's value is how many happened. A
 * "work out 4 times this week" goal is then a threshold of 1 over 4 qualifying
 * days, identical on both providers.
 *
 * Unscored sessions still count. Unlike sleep, the score is not the evidence
 * here - the session happening is, and WHOOP records the session either way.
 */
async function workoutsByDay(
  address: string,
  startISO: string,
  endISO: string,
): Promise<Map<string, number>> {
  const records = await fetchPaged<WorkoutRecord, WorkoutPage>(
    address,
    "/v2/activity/workout",
    startISO,
    endISO,
  );
  const byDay = new Map<string, number>();
  for (const record of records) {
    const day =
      typeof record.end === "string" && record.end.length >= 10
        ? record.end.slice(0, 10)
        : null;
    if (day === null) continue;
    byDay.set(day, (byDay.get(day) ?? 0) + 1);
  }
  return byDay;
}

// ---------------------------------------------------------------- the provider

export const whoopProvider: WearableProvider = {
  id: "whoop",
  label: "WHOOP",
  readService: "whoop-read",
  // WHOOP's brand rules require data sourced from them to say so; "Data by
  // WHOOP" is one of their approved lockups and this row is where the receipt
  // states it.
  readLabel: "wearable summary (Data by WHOOP)",
  // The WHOOP API is currently free to use, so the read costs nothing beyond
  // the request itself. Reported as zero rather than as a made-up cent: the
  // receipt is a record of money that actually moved.
  readEstUsd: "0.00",
  metrics: WHOOP_METRICS,

  async startLink(): Promise<WearableLink> {
    // WHOOP linking is an OAuth redirect that must carry a CSRF nonce bound to
    // the wallet, and the nonce has to be set as an httpOnly cookie on the
    // very response that redirects. Only a route handler can do that, so
    // /api/wearable/link builds it there and this method is never the path.
    throw new Error(
      "WHOOP linking runs through the OAuth redirect at /api/whoop/login.",
    );
  },

  /**
   * True when this wallet has a WHOOP grant that still works. A revoked or
   * expired grant answers false, not an error: the user can fix it by linking
   * again, which is a different message from the provider being down.
   */
  async isConnected(address: string): Promise<boolean> {
    if (!whoopConfigured()) return false;
    const stored = await readTokens("whoop", address);
    if (stored === null) return false;
    try {
      await accessTokenFor(address);
      return true;
    } catch (err) {
      if (err instanceof WhoopReauthorizationRequired) return false;
      throw err;
    }
  },

  /**
   * Qualifying days for one metric over a pool window.
   *
   * Refuses a metric WHOOP cannot measure rather than answering zero. The
   * caller turns that into a fail-closed verdict naming the real reason, so a
   * WHOOP user in a steps pool is told their device cannot verify it instead
   * of being marked as having walked nothing.
   */
  async getMetricProgress(
    address: string,
    metric: WearableMetric,
    threshold: number,
    windowStartISO: string,
    windowEndISO: string,
  ): Promise<MetricProgress> {
    if (!WHOOP_METRICS.includes(metric)) {
      throw new WhoopMetricUnsupported(
        `WHOOP cannot measure ${metric}. A WHOOP strap reports sleep and ` +
          "workouts, not step counts or daily distance.",
      );
    }

    const now = new Date();
    const from = rfc3339(startOfDayUTC(windowStartISO));
    const to = rfc3339(now);

    // sourceDays is what separates "nothing has synced" from "this device
    // does not report that number". For sleep, a night WHOOP scored without a
    // performance percentage is a sourced day with no value for sleep_score.
    // For workouts, every day in the window is sourced: a day with no session
    // means the person did not train, which is a real zero.
    let byDay: Map<string, number>;
    let sourceDays: Set<string> | null;
    if (metric === "workouts") {
      byDay = await workoutsByDay(address, from, to);
      sourceDays = null;
    } else {
      const records = (await fetchSleep(address, from, to)).filter(isCountable);
      byDay = bestScorePerDay(
        records.map((record) => ({
          day: dayOf(record),
          value: sleepMetricValueOf(record, metric),
        })),
      );
      sourceDays = new Set(
        records
          .map((record) => dayOf(record))
          .filter((day): day is string => day !== null),
      );
    }

    const sourced =
      sourceDays === null
        ? countQualifyingDays(
            // Every day in the window counts as sourced for a count metric.
            new Map(),
            Number.NEGATIVE_INFINITY,
            0,
            windowStartISO,
            windowEndISO,
            now,
          )
        : 0;

    return {
      qualifyingDays: countQualifyingDays(
        byDay,
        threshold,
        0,
        windowStartISO,
        windowEndISO,
        now,
      ),
      // Days that carried a value for THIS metric.
      daysWithData: countQualifyingDays(
        byDay,
        Number.NEGATIVE_INFINITY,
        0,
        windowStartISO,
        windowEndISO,
        now,
      ),
      daysWithSource:
        sourceDays === null
          ? sourced
          : countQualifyingDays(
              new Map([...sourceDays].map((day) => [day, 1])),
              Number.NEGATIVE_INFINITY,
              0,
              windowStartISO,
              windowEndISO,
              now,
            ),
    };
  },

  async getProgress(
    address: string,
    threshold: number,
    goalDays: number,
    windowStartISO?: string,
    windowEndISO?: string,
  ): Promise<WearableProgress> {
    const now = new Date();
    // Reach back far enough to cover the baseline week (days 8-14 back) as
    // well as the goal window itself, or the rolling lookback when there is
    // no pool period.
    const start =
      windowStartISO !== undefined
        ? startOfDayUTC(windowStartISO)
        : new Date(now.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 3600 * 1000);
    const baselineReach = new Date(
      now.getTime() - DEFAULT_LOOKBACK_DAYS * 24 * 3600 * 1000,
    );
    const from = start < baselineReach ? start : baselineReach;

    const records = (
      await fetchSleep(address, rfc3339(from), rfc3339(now))
    ).filter(isCountable);
    const byDay = bestScorePerDay(
      records.map((record) => ({
        day: dayOf(record),
        value: scoreOf(record),
      })),
    );
    const nightsReported = new Set(
      records.map((record) => dayOf(record)).filter((day) => day !== null),
    ).size;

    return {
      streakDays: countQualifyingDays(
        byDay,
        threshold,
        goalDays,
        windowStartISO,
        windowEndISO,
        now,
      ),
      baselineWeekAvg: baselineWeekAverage(byDay),
      days: daySeries(byDay),
      nightsReported,
    };
  },

  /**
   * Recent nights for the dashboard card.
   *
   * The activity array is always empty: WHOOP measures strain and does not
   * report step counts, and the app does not request the cycle scope. Reported
   * as absent rather than as zeros - a row of "0 steps" would read as a user
   * who did not move, which is a lie about their week.
   */
  async getRecent(address: string, days: number): Promise<WearableRecent> {
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 3600 * 1000);
    const records = await fetchSleep(address, rfc3339(from), rfc3339(now));

    const sleep = records
      .filter(isCountable)
      .map((record) => {
        const date = dayOf(record);
        if (date === null) return null;
        const inBedMs = record.score?.stage_summary?.total_in_bed_time_milli;
        return {
          date,
          score: scoreOf(record),
          hours:
            typeof inBedMs === "number"
              ? Math.round((inBedMs / 3_600_000) * 10) / 10
              : null,
        };
      })
      .filter(
        (
          entry,
        ): entry is { date: string; score: number | null; hours: number | null } =>
          entry !== null,
      )
      .sort((a, b) => (a.date < b.date ? 1 : -1));

    return { sleep, activity: [] };
  },

  /**
   * Drop the connection. WHOOP's revoke endpoint is called first so the grant
   * is actually gone on their side, but a failure there does not stop the
   * local record being deleted: leaving a token we can no longer honour would
   * strand the user as permanently "connected" with every read failing.
   */
  async disconnect(address: string): Promise<void> {
    try {
      const token = await accessTokenFor(address);
      const res = await fetch(`${API_BASE}/v2/user/access`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${token}` },
        signal: AbortSignal.timeout(timeoutMs()),
      });
      if (!res.ok && res.status !== 404) {
        console.warn(
          `[whoop] revoke for ${address.toLowerCase()} returned ${res.status}`,
        );
      }
    } catch (err) {
      if (!(err instanceof WhoopReauthorizationRequired)) {
        console.warn(
          `[whoop] revoke for ${address.toLowerCase()} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    } finally {
      await clearTokens("whoop", address);
    }
  },
};
