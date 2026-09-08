// Two questions the pool list has to answer before it invites anyone to spend
// an entry fee, kept out of the page so they can be tested in node.
//
// 1. An expired pool nobody joined is not "awaiting settlement". settle() has
//    no participant to pay, so nothing will ever happen to it - it would sit
//    under that heading forever, telling the visitor a payout is coming that
//    never is. Six such pools exist on the live contract.
//
// 2. A wearable goal cannot be verified while the wearable provider is
//    refusing us, so its pool must not read as joinable during an outage. The
//    entry fee is real money, paid up front, for a goal SPOTTER has no way to
//    check.
//
// 3. A wearable goal cannot be verified by a device that does not measure it,
//    ever. A WHOOP strap has no pedometer, so a WHOOP-backed wallet can no
//    more complete a steps pool than it can during an outage - except that
//    this one will never resolve. Before this, such a wallet could browse the
//    pool, stake USDC, and only discover the mismatch when SPOTTER failed the
//    claim. A rejection after the money has moved is a trap, not an error.
//
// (2) and (3) are DELIBERATELY separate outcomes. An outage is temporary and
// the answer is to wait; an unmeasurable metric is permanent and the answer is
// to connect a different device. Collapsing them would tell somebody to come
// back later for a goal their strap will never be able to prove.
//
// All three take their inputs from live sources (participant counts read off
// the chain, provider health and provider capabilities read off the wearable
// routes); nothing here is hard-coded to a pool id or a provider.

import { evidenceTypeOf } from "@/lib/contract";
import { classifyWearableGoal, type WearableMetric } from "@/lib/wearable-goal";

export interface ExpiredSplit<T> {
  /** Ended with participants on record - settlement still has work to do. */
  awaitingSettlement: T[];
  /** Ended with nobody joined - settlement can never pay anyone here. */
  closedEmpty: T[];
}

/**
 * Split expired pools by whether settlement has anyone to pay.
 *
 * `participantCountOf` returns null when the count is not known yet (the read
 * is still in flight, or it failed). Unknown stays in awaitingSettlement on
 * purpose: announcing that nobody joined a pool we have not counted would be a
 * claim the page cannot back.
 */
export function splitExpiredPools<T>(
  expired: T[],
  participantCountOf: (pool: T) => number | null,
): ExpiredSplit<T> {
  const awaitingSettlement: T[] = [];
  const closedEmpty: T[] = [];
  for (const pool of expired) {
    if (participantCountOf(pool) === 0) closedEmpty.push(pool);
    else awaitingSettlement.push(pool);
  }
  return { awaitingSettlement, closedEmpty };
}

export interface VerifiabilitySplit<T> {
  verifiable: T[];
  /** Goals SPOTTER cannot check RIGHT NOW. Temporary. Do not invite entry fees. */
  unverifiable: T[];
  /**
   * Goals this viewer's own device can NEVER measure. Permanent for as long as
   * they stay on that provider, and fixable only by connecting another one.
   */
  unsupported: T[];
}

/**
 * What the viewer's linked device can measure, or null when it is not known -
 * nobody signed in, the read is still in flight, or it failed.
 */
export type ViewerCapability = readonly WearableMetric[] | null;

/**
 * Split pools by whether their goal can be verified, for THIS viewer, right
 * now. Only wearable goals depend on a device; document goals run through the
 * TEE attester and are unaffected.
 *
 * The outage check comes first and stays global: while the provider is
 * refusing us, nothing wearable is verifiable regardless of hardware.
 *
 * The capability check is per viewer. `viewerMetrics` of null holds NOTHING
 * back: a page must not take a pool off the board on a guess about a device it
 * has not identified, and a logged-out visitor browsing what is on offer is
 * not about to stake anything. A goal whose metric cannot be classified at all
 * is also left alone here - it fails closed later, at the claim, where the
 * verdict can say so precisely.
 */
export function splitByVerifiability<T extends { goalSpec: string }>(
  pools: T[],
  providerDown: boolean,
  viewerMetrics: ViewerCapability = null,
): VerifiabilitySplit<T> {
  const verifiable: T[] = [];
  const unverifiable: T[] = [];
  const unsupported: T[] = [];

  for (const pool of pools) {
    if (evidenceTypeOf(pool.goalSpec) !== "wearable") {
      verifiable.push(pool);
      continue;
    }
    if (providerDown) {
      unverifiable.push(pool);
      continue;
    }
    if (viewerMetrics === null) {
      verifiable.push(pool);
      continue;
    }
    const metric = classifyWearableGoal(pool.goalSpec).metric;
    if (metric !== null && !viewerMetrics.includes(metric)) {
      unsupported.push(pool);
      continue;
    }
    verifiable.push(pool);
  }

  return { verifiable, unverifiable, unsupported };
}

/**
 * Why this viewer's device cannot prove this pool, or null when it can (or
 * when there is nothing to say yet). Used by the pool page, which shows one
 * goal rather than a list.
 *
 * Deliberately returns the METRIC and not a sentence: the copy lives in the
 * component next to the button it disables, where it can also name the
 * provider and offer the way out.
 */
export function unsupportedMetricFor(
  goalSpec: string,
  viewerMetrics: ViewerCapability,
): WearableMetric | null {
  if (viewerMetrics === null) return null;
  if (evidenceTypeOf(goalSpec) !== "wearable") return null;
  const metric = classifyWearableGoal(goalSpec).metric;
  if (metric === null) return null;
  return viewerMetrics.includes(metric) ? null : metric;
}
