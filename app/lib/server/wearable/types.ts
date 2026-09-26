// The provider-neutral wearable interface.
//
// GoHealthMe reads health data through exactly one shape, and two very
// different integrations satisfy it:
//
//   junction  a paid unified API (WHOOP/Oura/Fitbit/Garmin) where the provider
//             holds the user mapping and we hold only an API key
//   whoop     a direct OAuth 2.0 integration where WHOOP holds nothing for us
//             and we hold the user's access and refresh tokens ourselves
//
// Those differ in every mechanical detail - auth header vs bearer token, a
// hosted link page vs an authorize redirect, a server-side user_id vs a
// per-wallet token record - and in none of the details the rest of the app
// cares about. Everything downstream of this file wants the same four
// answers: can this wallet be linked, is it linked, how many qualifying days
// does it have, and what did the last week look like.
//
// Keeping that contract in one place is what makes a second provider a new
// file rather than a new branch in nine call sites.
//
import type { WearableMetric } from "@/lib/wearable-goal";
import type { ProviderId } from "@/lib/wearable-providers";

// PRIVACY INVARIANT, INHERITED BY EVERY IMPLEMENTATION: raw health samples
// never cross this boundary. A provider module may read whole sleep records
// upstream; what it returns is counts, per-day scores and labels. Nothing
// here is ever written on-chain directly.

export {
  PROVIDER_IDS,
  isProviderId,
  type ProviderId,
} from "@/lib/wearable-providers";

/**
 * The wearable metrics a goal can be verified against. Declared once in
 * lib/wearable-goal.ts, which the browser can also import - the pool list has
 * to know what a goal measures to warn about a mismatch before the stake.
 */
export type { WearableMetric } from "@/lib/wearable-goal";

/** What a provider knows about one wallet's actual hardware. */
export type ObservedCapability =
  | { kind: "observed"; metrics: readonly WearableMetric[] }
  | { kind: "declared" }
  /**
   * Linked, answering, and nothing has arrived from the device yet. Only a
   * multi-brand provider reports this: its declared list is a union across
   * brands, so "nothing observed" says nothing about what THIS device can do,
   * and offering the union is how a WHOOP-via-Junction wallet was invited onto
   * a steps run it can never win. Withholds the join until the first sync.
   */
  | { kind: "awaiting-sync" }
  | { kind: "unknown" };

/**
 * Per-window result for one metric.
 *
 * daysWithData === 0 means "connected but nothing has synced for this period
 * yet", which the verdict must treat as sync-in-progress and NOT as a missed
 * goal. A provider that collapsed the two would pay nobody and tell them they
 * failed.
 */
export interface MetricProgress {
  qualifyingDays: number;
  /** Days inside the window that carried a value for THIS metric. */
  daysWithData: number;
  /**
   * Days the device reported anything usable for, whether or not it carried
   * this metric. Separates "has not synced yet", which waiting fixes, from
   * "does not measure this", which waiting never fixes.
   */
  daysWithSource: number;
}

/**
 * Derived, privacy-safe sleep-streak progress for the dashboard card.
 *
 * `streakDays` is a COUNT of qualifying days inside the window, not a strict
 * consecutive run - a single missing night of wearable data must not wipe out
 * a week of real behaviour. Both implementations count the same way so a pool
 * cannot pay differently depending on which provider read it.
 */
export interface WearableProgress {
  /** Qualifying days inside the window (score >= threshold). */
  streakDays: number;
  /** Average score over days 8-14 back, feeding the comeback multiplier. */
  baselineWeekAvg: number | null;
  /** Per-day scores actually used, newest first. Never leaves the server. */
  days: Array<{ date: string; score: number }>;
  /**
   * Nights the device reported at all, scored or not. Lets the dashboard tell
   * "nothing has synced yet" from "this device does not produce that number" -
   * the first resolves by waiting and the second never does.
   */
  nightsReported: number;
}

/** Recent per-day data for the dashboard card. Display only. */
export interface WearableRecent {
  sleep: Array<{ date: string; score: number | null; hours: number | null }>;
  activity: Array<{ date: string; steps: number | null }>;
}

/**
 * How to link a device with this provider.
 *
 * Two shapes, because the providers are not the same kind of thing. Junction
 * and WHOOP both end in a consent page a browser can open. Apple Health has no
 * web OAuth at all - HealthKit is readable only on the device - so any
 * Apple-style provider has to hand the user off to a phone instead, and a
 * caller that assumed every link was a URL to open would silently do nothing
 * for it.
 *
 * The discriminator forces every connect surface to decide what it does for
 * each shape rather than defaulting to window.open and hoping.
 */
export type WearableLink =
  /** Open this URL; the user authorizes and comes back. */
  | { kind: "oauth"; linkUrl: string }
  /**
   * The connection happens in a phone app. `linkUrl` is a deep link where one
   * exists, and `instructions` is what to tell a user reading this on a
   * desktop, where the deep link cannot help them.
   */
  | {
      kind: "app";
      linkUrl: string | null;
      instructions: string;
      /**
       * A one-time code the phone app redeems to learn which wallet it syncs
       * for (Apple Health; see apple-pairing.ts). Absent for providers whose
       * app signs in on its own.
       */
      pairing?: { code: string; deepLink: string; expiresAt: number };
      /** Where to get the phone app, when the deployment names one. */
      installUrl?: string | null;
    };

/**
 * One health-data integration.
 *
 * Implementations must never throw for "not linked" - that is `isConnected`
 * returning false. Throwing is reserved for the provider being unreachable or
 * refusing us, which the routes turn into a 502 and the UI reports as an
 * outage the user cannot fix.
 */
export interface WearableProvider {
  readonly id: ProviderId;
  /** Human name used in receipts, verdict prose and UI copy. */
  readonly label: string;
  /**
   * Ledger service name for the read SPOTTER buys before verifying. Mirrored
   * in lib/claim-restore.ts, which reads it back out of the ledger to pick the
   * proof tab - add a provider there whenever one is added here.
   */
  readonly readService: string;
  /** Spend-row label rendered on the agent receipt. */
  readonly readLabel: string;
  /** Estimated USD cost of one read, as a decimal string. */
  readonly readEstUsd: string;
  /**
   * The metrics this provider can actually measure.
   *
   * NOT every provider can answer every goal. WHOOP reports sleep and strain
   * and has no step count at all, so a WHOOP-backed wallet cannot verify a
   * steps pool. Declaring the gap is what lets the verdict fail CLOSED with an
   * honest reason instead of reading zero steps and telling somebody who
   * walked 12,000 that they missed the goal.
   */
  readonly metrics: readonly WearableMetric[];

  /**
   * How this provider's link ENDS, declared rather than discovered.
   *
   * The caller has to know BEFORE it calls startLink, because when the choice
   * of provider is recorded depends on it. An "oauth" link ends at a consent
   * page, and the choice must be recorded first so a user who abandons that
   * page is still pointed at the provider they picked. An "app" link confirms
   * nothing at all - nothing is provisioned, no consent happens, and the user
   * may never open the phone - so recording on the tap would switch a wallet
   * with a WORKING provider to one with no data because somebody read a
   * sentence and closed the tab. Those providers record the choice when data
   * first arrives, which is their equivalent of a callback.
   *
   * MUST agree with the `kind` that startLink returns. They are two separate
   * declarations of one fact and nothing in the type system ties them
   * together, so the link route checks and complains.
   */
  readonly linkKind: WearableLink["kind"];

  /** Begin linking a device for this wallet. */
  startLink(address: string): Promise<WearableLink>;
  /** True once this wallet has a usable connection. Never throws for "no". */
  isConnected(address: string): Promise<boolean>;
  /**
   * Qualifying days for one metric over a pool window. This is the read a
   * verdict is derived from, so it is the one that must be metric-correct.
   *
   * Callers must check `metrics` first: asking for a metric this provider does
   * not serve throws, because silently returning zero would pay nobody and
   * blame the user.
   */
  getMetricProgress(
    address: string,
    metric: WearableMetric,
    threshold: number,
    windowStartISO: string,
    windowEndISO: string,
  ): Promise<MetricProgress>;
  /**
   * Sleep-streak progress for the dashboard card. When a window is given,
   * progress is scoped to [windowStartISO, min(windowEndISO, today)];
   * otherwise it falls back to the last `goalDays`.
   */
  getProgress(
    address: string,
    threshold: number,
    goalDays: number,
    windowStartISO?: string,
    windowEndISO?: string,
  ): Promise<WearableProgress>;
  /** Recent per-day sleep and activity for the dashboard card. */
  getRecent(address: string, days: number): Promise<WearableRecent>;
  /**
   * What this WALLET's device has actually produced, as a three-way answer.
   *
   * WHY NOT `WearableMetric[] | null`. It was, and null carried two meanings
   * that need opposite handling: "nothing observed yet", where falling back to
   * the declared list is right, and "every probe failed", where falling back
   * offers the full declared union on no evidence at all. A Junction outage
   * therefore handed a wallet all seven metrics including sleep_score, and the
   * answer was cached for thirty minutes. The state that exists to prevent
   * learn-after-the-stake was producing it.
   *
   *   observed  narrowed to what this wallet's hardware actually produced.
   *   declared  the provider's declared list is accurate for this wallet -
   *             either the hardware is uniform (every WHOOP strap is the same)
   *             or nothing has been observed yet and there is nothing to
   *             narrow. Permissive on purpose: a wallet that linked ten
   *             minutes ago must not have its whole board blanked.
   *   awaiting-sync  multi-brand provider, answering, nothing synced yet.
   *             The declared union is not evidence about this device, so the
   *             join is withheld until the first sync shows what it measures.
   *             Cached briefly at most, so a fresh sync unlocks quickly.
   *   unknown   we could not find out. Withhold the join rather than assume,
   *             and NEVER cache this - a cached unknown is an outage that
   *             outlives itself.
   *
   * Must be cheap enough to call on a browse surface: cache `observed` and
   * `declared`, never `unknown`.
   */
  observedMetrics(address: string): Promise<ObservedCapability>;
  /** Forget this wallet's connection. Idempotent. */
  disconnect(address: string): Promise<void>;
}
