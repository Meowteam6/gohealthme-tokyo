// SPOTTER's wearable evidence source: a poll-compatible reader over whichever
// health-data provider backs the participant, for pools whose goal is a
// device-verified target.
//
// Why this exists: the run loop only understands deps.poll(ref, goalSpec) ->
// PollResult. Document claims satisfy it with the TEE attester; wearable claims
// have no attester - the evidence is the participant's own provider summary
// scoped to the pool period. This module CLASSIFIES the goal into the metric it
// is actually about (steps / sleep score / sleep hours / workouts / distance /
// calories), reads THAT metric, and derives the verdict DETERMINISTICALLY (a
// qualifying-day threshold, not a probabilistic judgement). Confidence is "high"
// whenever the data was readable, so the run loop's escalation path never fires
// for wearables.
//
// A goal that maps to no metric fails CLOSED with an honest reason and pays
// nothing - it must never fall through to sleep (the bug this fixes: a steps
// goal was silently judged on sleep score). A connected device that has not yet
// synced returns a low-confidence "syncing" verdict, not a paid "you failed".
//
// THE SAME RULE APPLIES ACROSS PROVIDERS. Junction normalises several brands
// and can answer the whole metric vocabulary; WHOOP-direct measures sleep and
// strain and has no step count at all. So a metric the participant's own
// provider cannot measure ALSO fails closed, with a reason that names the
// device rather than the person. Reading zero steps off a WHOOP would tell
// somebody who walked 12,000 that they missed the goal, and pay them nothing.
//
// The claim's ref is `wearable-${periodStart}` (synthesized by the run route),
// so the junction-read purchase dedupes to one per pool period while the derived
// verdict tracks fresh data on every poll.
//
// Privacy: only the derived qualifying-day count crosses this boundary. Raw
// wearable records stay inside the provider module and never reach the ledger,
// the reason step, or the chain.

import type { Address } from "viem";
import { providerFor, type WearableMetric } from "@/lib/server/wearable";
import type { PollResult } from "@/lib/server/judge";
import type { ServiceQuote } from "@/lib/server/agent/x402";

export const DEFAULT_GOAL_DAYS = 7;
/** Retained default sleep-score threshold, kept exported for compatibility. */
export const DEFAULT_THRESHOLD = 75;

/**
 * The read SPOTTER buys before verifying a wearable claim, named for the
 * provider that will actually serve it.
 *
 * Both providers are metered outside x402 - Junction under our API key, WHOOP
 * under a free developer quota - so the quote is always prepaid, and a null
 * url means buyLive never invents a payment reference for it.
 */
export async function wearableReadQuote(
  address: string,
): Promise<ServiceQuote> {
  const provider = await providerFor(address);
  return {
    service: provider.readService,
    label: provider.readLabel,
    estUsd: provider.readEstUsd,
    url: null,
  };
}

/**
 * A goal classified into the wearable metric it is actually about, with the
 * per-day threshold and the number of qualifying days needed.
 *
 * metric === null means the goal cannot be checked from a wearable, so the
 * verdict fails closed and never pays - the alternative (guessing a metric)
 * pays or denies real USDC on the wrong measurement.
 */
export interface WearableSpec {
  metric: WearableMetric | null;
  /** Per-day target value, in the metric's own unit. */
  threshold: number;
  /** Qualifying days needed inside the pool period. */
  goalDays: number;
  /** Unit for the verdict reason ("steps", "hours of sleep", "km", ...). */
  unit: string;
  /** Short human name of the metric for copy ("steps", "sleep", ...). */
  label: string;
}

/**
 * Days the goal must be hit. Reads "for 7 days" / "5 nights" / "7-day", a
 * "3 times" / "4x" count (that many qualifying days), or a "week"/"month"
 * cadence. Falls back to a 7-day week.
 */
function parseGoalDays(goalSpec: string): number {
  const text = goalSpec.toLowerCase();
  const dayMatch = /(\d+)[\s-]*(?:day|night)/.exec(text);
  if (dayMatch) {
    const n = Number(dayMatch[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 60) return n;
  }
  const timesMatch = /(\d+)\s*(?:x|times)\b/.exec(text);
  if (timesMatch) {
    const n = Number(timesMatch[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 60) return n;
  }
  if (/\bmonth\b/.test(text)) return 30;
  if (/\bweek\b/.test(text)) return 7;
  return DEFAULT_GOAL_DAYS;
}

/**
 * Classify a pool's free-form goal text into the wearable metric it measures,
 * plus the per-day threshold and qualifying-day count. Deterministic keyword +
 * number matching over the common health goals; anything it cannot confidently
 * map returns metric: null so the verdict fails closed rather than guessing.
 */
export function classifyWearableGoal(goalSpec: string): WearableSpec {
  const text = goalSpec.toLowerCase();
  const goalDays = parseGoalDays(goalSpec);

  // STEPS - "8000 steps", "8k steps", "8,000 steps a day".
  if (/\bsteps?\b/.test(text)) {
    let threshold = 8000;
    const m = /(\d[\d,]*)\s*(k?)\s*steps?/.exec(text);
    if (m) {
      let v = Number(m[1].replace(/,/g, ""));
      if (m[2] === "k") v *= 1000;
      if (Number.isFinite(v) && v >= 100 && v <= 200000) threshold = v;
    }
    return { metric: "steps", threshold, goalDays, unit: "steps", label: "steps" };
  }

  // DISTANCE - a run/ride/swim/walk with an explicit km or mile figure.
  const dist = /(\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?|miles?|mi)\b/.exec(
    text,
  );
  if (
    dist !== null &&
    /\b(run|ran|running|jog|jogs|jogged|jogging|cycle|cycling|bike|biking|ride|riding|swim|swims|swimming|walk|walked|walking|distance)\b/.test(
      text,
    )
  ) {
    let v = Number(dist[1]);
    if (/mile|mi\b/.test(dist[2])) v *= 1.60934; // miles -> km
    v = Math.round(v * 100) / 100;
    return {
      metric: "distance_km",
      threshold: v,
      goalDays,
      unit: "km",
      label: "distance",
    };
  }

  // SLEEP - duration ("sleep 7 hours").
  if (/\bsleep\b/.test(text) && /\b(hours?|hrs?)\b/.test(text)) {
    let threshold = 7;
    const m = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/.exec(text);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v >= 1 && v <= 16) threshold = v;
    }
    return {
      metric: "sleep_hours",
      threshold,
      goalDays,
      unit: "hours of sleep",
      label: "sleep",
    };
  }

  // SLEEP - score / efficiency, or a bare "sleep" goal (backwards compatible).
  if (/\bsleep\b/.test(text)) {
    let threshold = 75;
    const m =
      /(?:score|efficiency)\s*(?:of|>=|at least|above)?\s*(\d{1,3})/.exec(
        text,
      ) ?? /(\d{1,3})\s*\+/.exec(text);
    if (m) {
      const v = Number(m[1]);
      if (Number.isInteger(v) && v >= 1 && v <= 100) threshold = v;
    }
    return {
      metric: "sleep_score",
      threshold,
      goalDays,
      unit: "sleep score",
      label: "sleep",
    };
  }

  // WORKOUTS / EXERCISE / RUNS-RIDES-SWIMS without a distance: a day qualifies
  // when at least one session happened; the "N times" count is the day count.
  if (
    /\b(workout|workouts|work out|exercise|exercises|gym|train|training|trained|lift|lifting|run|ran|running|jog|jogged|jogging|cycle|cycling|bike|biking|ride|riding|swim|swims|swimming|session|sessions|hiit|yoga|pilates)\b/.test(
      text,
    )
  ) {
    return {
      metric: "workouts",
      threshold: 1,
      goalDays,
      unit: "workout",
      label: "workout",
    };
  }

  // ACTIVE CALORIES.
  if (/\b(calories?|kcal)\b/.test(text)) {
    let threshold = 500;
    const m = /(\d[\d,]*)\s*(?:calories?|kcal)/.exec(text);
    if (m) {
      const v = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(v) && v >= 50 && v <= 20000) threshold = v;
    }
    return {
      metric: "active_calories",
      threshold,
      goalDays,
      unit: "active calories",
      label: "calories",
    };
  }

  // Not verifiable from a wearable - fail closed.
  return { metric: null, threshold: 0, goalDays, unit: "", label: "" };
}

export interface WearableWindow {
  address: Address;
  /** Pool periodStart, epoch seconds (from the chain, not the caller). */
  periodStart: bigint;
  /** Pool periodEnd, epoch seconds. */
  periodEnd: bigint;
}

function isoDay(epochSeconds: bigint): string {
  return new Date(Number(epochSeconds) * 1000).toISOString().slice(0, 10);
}

/**
 * Build a deps.poll-compatible evidence source for one wearable claim. Never
 * throws: any Junction failure resolves to a failed, UNVERIFIED verdict so a
 * provider outage can neither pay a claim nor crash the run - and because the
 * run loop re-decides whenever this verdict's content changes, the next
 * successful poll recovers on its own.
 */
export function wearableEvidenceSource(
  window: WearableWindow,
): (ref: string, goalSpec: string) => Promise<PollResult> {
  return async (_ref, goalSpec) => {
    const spec = classifyWearableGoal(goalSpec);

    // A goal we cannot map to a wearable metric is NOT judged on sleep and NOT
    // paid: fail closed with an honest reason.
    if (spec.metric === null) {
      return {
        status: "failed",
        verdict: {
          verified: false,
          confidence: "low",
          reason:
            "SPOTTER could not tell which wearable metric this goal maps to " +
            "(steps, sleep, workouts, distance, or calories), so it was not " +
            "checked and nothing was paid. Reword the goal around one of those.",
        },
      };
    }

    try {
      const provider = await providerFor(window.address);

      // A metric this participant's device cannot measure fails closed, and
      // says which device, so the person can act on it by linking one that can.
      if (!provider.metrics.includes(spec.metric)) {
        return {
          status: "failed",
          verdict: {
            verified: false,
            confidence: "low",
            reason:
              `This goal is measured in ${spec.label}, which ${provider.label} ` +
              "does not report, so it could not be checked and nothing was " +
              "paid. Connect a device that tracks it from the dashboard.",
          },
        };
      }

      if (!(await provider.isConnected(window.address))) {
        return {
          status: "failed",
          verdict: {
            verified: false,
            confidence: "low",
            reason:
              "No wearable is connected for this wallet. Connect one from the " +
              "dashboard and run the check again.",
          },
        };
      }

      const progress = await provider.getMetricProgress(
        window.address,
        spec.metric,
        spec.threshold,
        isoDay(window.periodStart),
        isoDay(window.periodEnd),
      );

      // Connected but nothing has synced for this period yet: sync-in-progress,
      // NOT a missed goal. Low confidence routes this to sync guidance instead
      // of a paid "you failed".
      if (progress.daysWithData === 0) {
        return {
          status: "failed",
          verdict: {
            verified: false,
            confidence: "low",
            reason:
              `Your wearable is connected but has not synced any ${spec.label} ` +
              "data for this period yet. Give it a few minutes to sync, then " +
              "run the check again.",
          },
        };
      }

      if (progress.qualifyingDays >= spec.goalDays) {
        return {
          status: "completed",
          verdict: {
            verified: true,
            confidence: "high",
            reason:
              `Your wearable shows ${progress.qualifyingDays} qualifying days ` +
              `(${spec.threshold}+ ${spec.unit}) inside this pool period, ` +
              `meeting the ${spec.goalDays}-day goal.`,
          },
        };
      }

      return {
        status: "completed",
        verdict: {
          verified: false,
          confidence: "high",
          reason:
            `Your wearable shows ${progress.qualifyingDays} of ${spec.goalDays} ` +
            `qualifying days (${spec.threshold}+ ${spec.unit}) inside this pool ` +
            "period. The goal is not met yet.",
        },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(
        `[wearable] provider read failed for ${window.address}: ${message}`,
      );
      return {
        status: "failed",
        verdict: {
          verified: false,
          confidence: "low",
          reason:
            "The wearable data provider could not be reached, so nothing was " +
            "verified. Run the check again once it recovers.",
        },
      };
    }
  };
}
