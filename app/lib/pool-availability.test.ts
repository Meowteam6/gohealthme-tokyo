// Both splits guard a claim the page makes to a visitor. "Nobody joined" says
// a payout will never come; "cannot be verified" says do not pay the entry
// fee. Neither may be asserted on an unknown.

import { describe, it, expect } from "vitest";
import {
  splitByVerifiability,
  unsupportedMetricFor,
  splitExpiredPools,
} from "@/lib/pool-availability";

function pool(id: number) {
  return { id: BigInt(id) };
}

describe("splitExpiredPools", () => {
  it("moves zero-participant pools out of the settlement group", () => {
    const counts: Record<string, number> = { "1": 0, "2": 3, "3": 0 };
    const split = splitExpiredPools([pool(1), pool(2), pool(3)], (p) =>
      counts[p.id.toString()],
    );
    expect(split.closedEmpty.map((p) => p.id)).toEqual([1n, 3n]);
    expect(split.awaitingSettlement.map((p) => p.id)).toEqual([2n]);
  });

  it("keeps an uncounted pool in the settlement group", () => {
    const split = splitExpiredPools([pool(1), pool(2)], (p) =>
      p.id === 1n ? null : 0,
    );
    expect(split.awaitingSettlement.map((p) => p.id)).toEqual([1n]);
    expect(split.closedEmpty.map((p) => p.id)).toEqual([2n]);
  });

  it("preserves the incoming order inside each group", () => {
    const split = splitExpiredPools([pool(3), pool(1), pool(2)], () => 0);
    expect(split.closedEmpty.map((p) => p.id)).toEqual([3n, 1n, 2n]);
  });

  it("handles an empty list", () => {
    const split = splitExpiredPools<{ id: bigint }>([], () => 0);
    expect(split.awaitingSettlement).toEqual([]);
    expect(split.closedEmpty).toEqual([]);
  });
});

describe("splitByVerifiability", () => {
  const pools = [
    { id: 1n, goalSpec: "Sleep score 75 for 7 nights" },
    { id: 2n, goalSpec: "[doc] Annual flu shot" },
    { id: 3n, goalSpec: "10000 steps a day for 5 days" },
  ];

  it("holds nothing back while the provider is up", () => {
    const split = splitByVerifiability(pools, false);
    expect(split.verifiable.map((p) => p.id)).toEqual([1n, 2n, 3n]);
    expect(split.unverifiable).toEqual([]);
  });

  it("holds back only wearable goals while the provider is down", () => {
    const split = splitByVerifiability(pools, true);
    expect(split.unverifiable.map((p) => p.id)).toEqual([1n, 3n]);
    // Document goals run through the TEE attester and are unaffected.
    expect(split.verifiable.map((p) => p.id)).toEqual([2n]);
  });

  it("does not mutate the input", () => {
    const input = [...pools];
    splitByVerifiability(input, true);
    expect(input.map((p) => p.id)).toEqual([1n, 2n, 3n]);
  });
});

// The capability gate. Under the product rule, a limit has to surface at the
// JOIN and never at the claim: a rejection after somebody has staked USDC is a
// trap, not an error. A WHOOP strap has no pedometer, so a WHOOP-backed wallet
// must never be invited to pay an entry fee for a steps pool.

const STEPS = { goalSpec: "walk 8000 steps a day for 7 days [proof=wearable]" };
const SLEEP = { goalSpec: "sleep score 75+ for 7 days [proof=wearable]" };
// The real document marker is [doc]; "[proof=document]" is not a marker this
// codebase emits, so a fixture using it classifies as wearable and makes any
// assertion about document pools pass for the wrong reason.
const DOC = { goalSpec: "[doc] annual physical" };

const WHOOP_METRICS = [
  "sleep_score",
  "sleep_efficiency",
  "sleep_hours",
  "workouts",
] as const;
const FULL_METRICS = [...WHOOP_METRICS, "steps", "distance_km", "active_calories"] as const;

describe("splitByVerifiability capability gate", () => {
  it("holds back a steps pool from a device with no pedometer", () => {
    const split = splitByVerifiability([STEPS, SLEEP], false, WHOOP_METRICS);
    expect(split.unsupported).toEqual([STEPS]);
    expect(split.verifiable).toEqual([SLEEP]);
    expect(split.unverifiable).toEqual([]);
  });

  it("keeps an outage separate from a permanent mismatch", () => {
    // Different cause, different answer: waiting fixes an outage and never
    // fixes a missing pedometer, so they must not share a bucket.
    const down = splitByVerifiability([STEPS], true, WHOOP_METRICS);
    expect(down.unverifiable).toEqual([STEPS]);
    expect(down.unsupported).toEqual([]);
  });

  it("holds nothing back when the viewer's device is unknown", () => {
    // A logged-out visitor browsing what is on offer is not about to stake,
    // and the page must not take a pool off the board on a guess.
    const split = splitByVerifiability([STEPS, SLEEP], false, null);
    expect(split.verifiable).toEqual([STEPS, SLEEP]);
    expect(split.unsupported).toEqual([]);
  });

  it("never gates a document pool on a wearable's capabilities", () => {
    const split = splitByVerifiability([DOC], false, WHOOP_METRICS);
    expect(split.verifiable).toEqual([DOC]);
  });

  it("passes everything for a device that measures everything", () => {
    const split = splitByVerifiability([STEPS, SLEEP], false, FULL_METRICS);
    expect(split.unsupported).toEqual([]);
    expect(split.verifiable).toEqual([STEPS, SLEEP]);
  });

  it("leaves an unclassifiable goal alone rather than guessing", () => {
    // It fails closed later, at the claim, where the verdict can say exactly
    // why. Blocking it here would hide a pool for the wrong reason.
    const vague = { goalSpec: "be healthier [proof=wearable]" };
    const split = splitByVerifiability([vague], false, WHOOP_METRICS);
    expect(split.verifiable).toEqual([vague]);
    expect(split.unsupported).toEqual([]);
  });
});

describe("unsupportedMetricFor", () => {
  it("names the metric the viewer's device cannot produce", () => {
    expect(unsupportedMetricFor(STEPS.goalSpec, WHOOP_METRICS)).toBe("steps");
  });

  it("is null when the device can measure it", () => {
    expect(unsupportedMetricFor(SLEEP.goalSpec, WHOOP_METRICS)).toBeNull();
    expect(unsupportedMetricFor(STEPS.goalSpec, FULL_METRICS)).toBeNull();
  });

  it("is null when the viewer is unknown or the goal is not wearable", () => {
    expect(unsupportedMetricFor(STEPS.goalSpec, null)).toBeNull();
    expect(unsupportedMetricFor(DOC.goalSpec, WHOOP_METRICS)).toBeNull();
  });
});

describe("splitByVerifiability when the viewer has not been checked", () => {
  it("holds a connected wallet's wearable pools out of the joinable group", () => {
    // The gate's real failure mode. The client credential cache is module
    // memory that dies with the tab, so EVERY hard load of the pool list
    // starts unsigned and capability comes back unknown. Reading that as
    // "fine" is what let somebody stake on a goal their device cannot prove.
    const split = splitByVerifiability([STEPS, SLEEP, DOC], false, null, true);

    expect(split.unchecked).toEqual([STEPS, SLEEP]);
    // A document goal does not depend on a device at all.
    expect(split.verifiable).toEqual([DOC]);
    expect(split.unsupported).toEqual([]);
  });

  it("still shows everything to a logged-out visitor", () => {
    // Browsing is not staking. Somebody with no wallet is not about to pay an
    // entry fee, and hiding the board from them would be its own dead end.
    const split = splitByVerifiability([STEPS, SLEEP], false, null, false);

    expect(split.verifiable).toEqual([STEPS, SLEEP]);
    expect(split.unchecked).toEqual([]);
  });

  it("prefers a known answer over the unchecked group", () => {
    const split = splitByVerifiability([STEPS, SLEEP], false, WHOOP_METRICS, true);

    // Capability is known, so pendingness is irrelevant.
    expect(split.unchecked).toEqual([]);
    expect(split.unsupported).toEqual([STEPS]);
    expect(split.verifiable).toEqual([SLEEP]);
  });

  it("keeps an outage ahead of an unchecked viewer", () => {
    // Nothing wearable is verifiable during an outage regardless of hardware,
    // and that message is more useful than "sign to find out".
    const split = splitByVerifiability([STEPS], true, null, true);

    expect(split.unverifiable).toEqual([STEPS]);
    expect(split.unchecked).toEqual([]);
  });
});
