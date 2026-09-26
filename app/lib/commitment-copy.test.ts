import { describe, expect, it } from "vitest";
import {
  challengeStakeCopy,
  commitmentJoinCopy,
  commitmentShortCopy,
  createCommitmentCopy,
  missConsequence,
} from "@/lib/commitment-copy";
import { missRulePool } from "@/lib/miss-rule";

// F11 and F9 (fix/record-misses review): the forfeit promise ("miss it and
// your stake goes to the players who hit") is only true on a pool that can
// record a miss. Every other self-staked pool refunds a miss at settle, so its
// copy must say that instead, before the stake.

const SLEEP = "Sleep at least 7 hours for 1 night";
const miss = { id: 9n, bountyModel: 2, goalSpec: SLEEP };

describe("commitmentJoinCopy (the pool page, before the stake)", () => {
  it("promises the forfeit, the hold to confirm, and the parsed rule on a pool that records misses", () => {
    const copy = commitmentJoinCopy(miss, "1.00", 1n);
    expect(copy).toMatch(/goes to the players who hit/);
    expect(copy).toMatch(/confirm/);
    expect(copy).toMatch(/cancel/);
    expect(copy).toContain("SPOTTER reads this as 1 night at 7+ hours of sleep.");
  });

  it("promises no forfeit on a pool created before the cutoff (joined under the refund promise)", () => {
    const copy = commitmentJoinCopy({ ...miss, id: 5n }, "1.00", 6n);
    expect(copy).not.toMatch(/goes to the players who hit|missed stakes|forfeit/);
    expect(copy).toMatch(/comes back at settle/);
  });

  it("promises no forfeit on a document, steps or ambiguous pool", () => {
    for (const goalSpec of [
      `[doc] ${SLEEP}`,
      "Walk at least 8,000 steps for 1 day",
      "Sleep score 75+ on 5 of 7 nights",
    ]) {
      const copy = commitmentJoinCopy({ ...miss, goalSpec }, "5.00", 1n);
      expect(copy).not.toMatch(/goes to the players who hit|missed stakes|forfeit/);
      expect(copy).toMatch(/cannot record a miss/);
    }
  });
});

describe("commitmentShortCopy (lobby match cards)", () => {
  it("branches on whether the pool can record a miss", () => {
    expect(commitmentShortCopy(miss, 1n)).toMatch(/goes to the players who hit/);
    expect(commitmentShortCopy({ ...miss, id: 2n }, 6n)).not.toMatch(/players who hit/);
    expect(commitmentShortCopy({ ...miss, id: 2n }, 6n)).toMatch(/comes back when the run settles/);
  });
});

describe("createCommitmentCopy (the create form)", () => {
  it("promises the forfeit only for a wearable-only goal the miss rule can judge", () => {
    expect(createCommitmentCopy(SLEEP, 1n)).toMatch(/goes to the players who hit/);
    expect(createCommitmentCopy(`[doc] ${SLEEP}`, 1n)).toMatch(/cannot record a miss/);
    expect(createCommitmentCopy("Walk 8000 steps for 1 day", 1n)).toMatch(/cannot record a miss/);
    expect(createCommitmentCopy(SLEEP, null)).toMatch(/cannot record a miss/);
  });
});

describe("missConsequence (the miss chip)", () => {
  it("reads 'goes to who hits' only on a run that can record a miss with 2 or more stakers", () => {
    const recordable = missRulePool(miss, 1n).ok;
    expect(recordable).toBe(true);
    expect(missConsequence({ players: 2, recordable })).toBe("Miss: goes to who hits");
    expect(missConsequence({ players: 7, recordable })).toBe("Miss: goes to who hits");
  });

  it("reads 'stake back' with one staker: a lone miss means nobody hit, and every stake comes back", () => {
    expect(missConsequence({ players: 1, recordable: true })).toBe("Miss: stake back");
    expect(missConsequence({ players: 0, recordable: true })).toBe("Miss: stake back");
  });

  it("reads 'stake back' on every run the miss rule does not cover, however many stake", () => {
    for (const pool of [
      { ...miss, bountyModel: 0 },
      { ...miss, bountyModel: 1 },
      { ...miss, goalSpec: "Walk at least 8,000 steps for 1 day" },
      { ...miss, id: 5n },
    ]) {
      const recordable = missRulePool(pool, 6n).ok;
      expect(recordable).toBe(false);
      expect(missConsequence({ players: 5, recordable })).toBe("Miss: stake back");
    }
  });
});

describe("challengeStakeCopy (self-staked challenges are document-proven)", () => {
  it("never promises a cut of forfeits: a challenge cannot record a miss", () => {
    const copy = challengeStakeCopy();
    expect(copy).not.toMatch(/forfeit|goes to whoever|players who hit/);
    expect(copy).toMatch(/comes back at settle/);
  });
});
