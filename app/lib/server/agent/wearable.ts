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
import { providerFor } from "@/lib/server/wearable";
// Re-exported so existing callers and tests keep importing the classifier from
// here, while the browser imports the same implementation directly.
export {
  classifyWearableGoal,
  DEFAULT_GOAL_DAYS,
  DEFAULT_THRESHOLD,
  type WearableMetric,
  type WearableSpec,
} from "@/lib/wearable-goal";
import { classifyWearableGoal } from "@/lib/wearable-goal";
import type { PollResult } from "@/lib/server/judge";
import type { ServiceQuote } from "@/lib/server/agent/x402";

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

      // Connected but nothing has arrived for this period yet:
      // sync-in-progress, NOT a missed goal. Low confidence routes this to
      // sync guidance instead of a paid "you failed".
      if (progress.daysWithSource === 0) {
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

      // The device HAS been syncing and simply does not report this number -
      // a tracker with no sleep score will not grow one. Telling this person
      // to wait a few minutes would be advice that can never come true, so it
      // fails closed against the device rather than against them.
      if (progress.daysWithData === 0) {
        return {
          status: "failed",
          verdict: {
            verified: false,
            confidence: "low",
            reason:
              `Your wearable is syncing, but it does not report ${spec.label} ` +
              "for this goal, so there is nothing for SPOTTER to check and " +
              "nothing was paid. Connect a device that tracks it from the " +
              "dashboard.",
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
