import { describe, expect, it } from "vitest";
import { poolPhase } from "@/lib/pool-lifecycle";
import {
  closedRunTag,
  runEndCopy,
  settleTallyOf,
  sweepStateOf,
  type SettleTally,
} from "@/lib/game/run-end";

// The finished-run card and the creator's "take back the leftover" state,
// against HealthPoolsV3's settle/cancel/sweep rules.

const hit = { resultRecorded: true, verdict: true };
const miss = { resultRecorded: true, verdict: false };
const none = { resultRecorded: false, verdict: false };

function tally(achievers: number, refunded: number, missed = 0): SettleTally {
  return { total: achievers + refunded + missed, achievers, refunded, missed };
}

describe("settleTallyOf", () => {
  it("splits participants the way settle() does", () => {
    expect(settleTallyOf([hit, none, miss, none])).toEqual({
      total: 4,
      achievers: 1,
      refunded: 2,
      missed: 1,
    });
    expect(settleTallyOf([])).toEqual({ total: 0, achievers: 0, refunded: 0, missed: 0 });
  });
});

describe("runEndCopy", () => {
  const base = { phase: "settled" as const, bountyModel: 1, joined: true };

  it("never says anyone was paid when nobody hit it", () => {
    const copy = runEndCopy({ ...base, tally: tally(0, 3) });
    // F10: a hit nobody confirmed is not recorded, so the chain cannot say
    // nobody hit; it can say no hit was recorded.
    expect(copy.headline).toBe("Settled. No hit was recorded");
    expect(copy.body).toContain("No prize went out");
    expect(copy.body).toContain("credited back");
    expect(`${copy.headline} ${copy.body}`).not.toMatch(/paid the verified achievers/);
  });

  it("says a recorded miss stayed in the pool on a sponsor pool", () => {
    const copy = runEndCopy({ ...base, tally: tally(0, 1, 2) });
    expect(copy.body).toContain("2 recorded misses stayed in the pool");
  });

  it("refunds every staker on a self-staked pool nobody hit", () => {
    const copy = runEndCopy({ ...base, bountyModel: 2, tally: tally(0, 1, 2) });
    expect(copy.body).toContain("Every player's stake was credited back");
  });

  it("counts the achievers it read, and the refunds", () => {
    const copy = runEndCopy({ ...base, tally: tally(2, 1) });
    expect(copy.body).toContain("2 of 3 hit it");
    expect(copy.body).toContain("1 player with no recorded result got their stake back");
  });

  it("says the recorded misses went to the players who hit on a self-staked pool", () => {
    const copy = runEndCopy({ ...base, bountyModel: 2, tally: tally(1, 1, 2) });
    expect(copy.body).toContain("1 of 4 hit it");
    expect(copy.body).toContain("The stakes of 2 recorded misses went to the players who hit.");
    expect(copy.body).toContain("1 player with no recorded result got their stake back");
    // A pool with no recorded miss says nothing about misses.
    expect(runEndCopy({ ...base, bountyModel: 2, tally: tally(1, 1) }).body).not.toMatch(
      /recorded miss/,
    );
  });

  it("says nobody entered an empty run", () => {
    expect(runEndCopy({ ...base, tally: tally(0, 0) }).body).toContain("Nobody entered it");
  });

  it("stays neutral while the results are unknown", () => {
    const copy = runEndCopy({ ...base, tally: null });
    expect(copy.body).not.toMatch(/paid|hit it/);
  });

  it("never says a cancelled run paid anyone", () => {
    for (const joined of [true, false]) {
      const copy = runEndCopy({ phase: "cancelled", bountyModel: 0, joined, tally: tally(3, 0) });
      expect(copy.headline).toBe("Run cancelled");
      expect(copy.body).toContain("nobody was paid a prize");
      expect(copy.body).toContain("stake back");
    }
  });
});

describe("closedRunTag", () => {
  it("never says Paid out, and names a cancelled run", () => {
    expect(closedRunTag("cancelled")).toBe("Cancelled");
    expect(closedRunTag("settled")).toBe("Settled");
    expect(closedRunTag("expired")).toBe("Ended");
  });

  it("tags a cancelled pool Cancelled in the lobby, not Paid out", () => {
    // cancelPool sets settled AND cancelled; the lobby row carries poolPhase.
    const phase = poolPhase({ settled: true, cancelled: true, periodEnd: 10n }, 100n);
    expect(closedRunTag(phase)).toBe("Cancelled");
  });
});

describe("sweepStateOf", () => {
  const settled = {
    phase: "settled" as const,
    isCreator: true,
    balance: 5_000_000n,
    entryFee: 1_000_000n,
    refundLiability: 0n,
  };

  it("offers the leftover to the creator of a settled pool", () => {
    expect(sweepStateOf(settled)).toEqual({ kind: "ready", amount: 5_000_000n });
  });

  it("hides it from anyone who is not the creator", () => {
    expect(sweepStateOf({ ...settled, isCreator: false })).toEqual({ kind: "hidden" });
  });

  it("hides it while the run is live or waiting on settlement (sweep reverts NOT_SETTLED)", () => {
    expect(sweepStateOf({ ...settled, phase: "live" })).toEqual({ kind: "hidden" });
    expect(sweepStateOf({ ...settled, phase: "expired" })).toEqual({ kind: "hidden" });
  });

  it("says there is nothing left rather than offering a NOTHING_TO_SWEEP revert", () => {
    expect(sweepStateOf({ ...settled, balance: 0n })).toEqual({ kind: "empty" });
  });

  it("waits on unclaimed refunds on a cancelled pool (REFUNDS_PENDING)", () => {
    expect(
      sweepStateOf({ ...settled, phase: "cancelled", refundLiability: 2_000_000n }),
    ).toEqual({ kind: "refunds-pending", pendingStakes: 2, pendingAmount: 2_000_000n });
  });

  it("offers the true surplus once every refund on a cancelled pool is claimed", () => {
    expect(
      sweepStateOf({ ...settled, phase: "cancelled", balance: 3_000_000n, refundLiability: 0n }),
    ).toEqual({ kind: "ready", amount: 3_000_000n });
  });

  it("offers nothing on a cancelled pool whose refund liability is unknown", () => {
    expect(
      sweepStateOf({ ...settled, phase: "cancelled", refundLiability: null }),
    ).toEqual({ kind: "hidden" });
  });
});
