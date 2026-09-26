import { afterEach, describe, expect, it, vi } from "vitest";
import {
  missRuleFromPoolId,
  missRulePool,
  missRuleReading,
  missRuleWouldApply,
} from "@/lib/miss-rule";
import { strictGoalCount } from "@/lib/wearable-goal";

// The pool-level half of the miss rule. A recorded miss moves a stake, so the
// goal text has to say one count and only one, and SPOTTER's pass reading has
// to agree with it; a pool created before the commitment copy shipped never
// records a miss at all.

const POOL = { id: 7n, bountyModel: 2, goalSpec: "Sleep at least 7 hours for 1 night" };

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("strictGoalCount", () => {
  it("reads one explicit count of days or nights", () => {
    expect(strictGoalCount("Sleep at least 7 hours for 1 night")).toEqual({
      count: 1,
      sessions: false,
    });
    expect(strictGoalCount("Sleep score 80+ for 5 nights")).toEqual({ count: 5, sessions: false });
    expect(strictGoalCount("a 3-day sleep streak at 7 hours")).toEqual({ count: 3, sessions: false });
  });

  it("reads a times or workouts count as sessions", () => {
    expect(strictGoalCount("Hit the gym 2 times")).toEqual({ count: 2, sessions: true });
    expect(strictGoalCount("HIIT 4x")).toEqual({ count: 4, sessions: true });
  });

  it("accepts two counts only when they say the same number", () => {
    expect(strictGoalCount("Complete at least 1 workout for 1 day")).toEqual({
      count: 1,
      sessions: true,
    });
    expect(strictGoalCount("3 workouts in 5 days")).toBeNull();
  });

  it("refuses the goals that were misread (the forfeit cases)", () => {
    expect(strictGoalCount("Sleep score 75+ on 5 of 7 nights")).toBeNull();
    expect(strictGoalCount("Sleep 7 hours on 5 out of 7 nights")).toBeNull();
    expect(strictGoalCount("Work out twice this weekend")).toBeNull();
    expect(strictGoalCount("Sleep 7 hours every night this week")).toBeNull();
    expect(strictGoalCount("Sleep 7 hours for one night")).toBeNull();
  });
});

describe("missRulePool: the goal must be unambiguous", () => {
  it("refuses 'N of M nights', which the pass path reads as M", () => {
    expect(
      missRulePool({ ...POOL, goalSpec: "Sleep score 75+ on 5 of 7 nights" }, 1n),
    ).toEqual({ ok: false, basis: "goal-ambiguous" });
  });

  it("refuses '3 workouts this week', which the pass path reads as 7 days", () => {
    expect(missRulePool({ ...POOL, goalSpec: "3 workouts this week" }, 1n)).toEqual({
      ok: false,
      basis: "goal-ambiguous",
    });
  });

  it("refuses 'Work out twice this weekend', which the pass path reads as 7 days", () => {
    expect(missRulePool({ ...POOL, goalSpec: "Work out twice this weekend" }, 1n)).toEqual({
      ok: false,
      basis: "goal-ambiguous",
    });
  });

  it("accepts 'Hit the gym 2 times' and counts sessions, not days", () => {
    const rule = missRulePool({ ...POOL, goalSpec: "Hit the gym 2 times" }, 1n);
    expect(rule.ok).toBe(true);
    if (rule.ok) {
      expect(rule.spec.goalDays).toBe(2);
      expect(rule.spec.countsSessions).toBe(true);
    }
  });

  it("accepts the live launch goals", () => {
    for (const goalSpec of [
      "Sleep at least 7 hours for 1 night",
      "Sleep efficiency 85% or better for 1 night",
      "Complete at least 1 workout for 1 day",
    ]) {
      expect(missRulePool({ ...POOL, goalSpec }, 1n).ok).toBe(true);
    }
  });
});

describe("missRulePool: pools joined under the refund promise", () => {
  it("never records a miss on a pool created before MISS_RULE_FROM_POOL_ID", () => {
    expect(missRulePool({ ...POOL, id: 5n }, 6n)).toEqual({
      ok: false,
      basis: "before-miss-rule",
    });
    expect(missRulePool({ ...POOL, id: 6n }, 6n).ok).toBe(true);
  });

  it("is off everywhere when MISS_RULE_FROM_POOL_ID is unset or not a pool id", () => {
    vi.stubEnv("MISS_RULE_FROM_POOL_ID", "");
    expect(missRuleFromPoolId()).toBeNull();
    expect(missRulePool(POOL)).toEqual({ ok: false, basis: "before-miss-rule" });
    vi.stubEnv("MISS_RULE_FROM_POOL_ID", "abc");
    expect(missRuleFromPoolId()).toBeNull();
    vi.stubEnv("MISS_RULE_FROM_POOL_ID", "0");
    expect(missRuleFromPoolId()).toBeNull();
  });

  it("reads the cutoff from the environment", () => {
    vi.stubEnv("MISS_RULE_FROM_POOL_ID", "6");
    expect(missRuleFromPoolId()).toBe(6n);
    expect(missRulePool({ ...POOL, id: 5n }).ok).toBe(false);
    expect(missRulePool({ ...POOL, id: 6n }).ok).toBe(true);
  });

  it("tells the create form whether a new pool would record misses", () => {
    expect(missRuleWouldApply({ bountyModel: 2, goalSpec: POOL.goalSpec }, 6n)).toBe(true);
    expect(missRuleWouldApply({ bountyModel: 2, goalSpec: POOL.goalSpec }, null)).toBe(false);
    expect(missRuleWouldApply({ bountyModel: 2, goalSpec: `[doc] ${POOL.goalSpec}` }, 6n)).toBe(
      false,
    );
  });
});

describe("missRuleReading", () => {
  it("says the rule SPOTTER will run, in plain words", () => {
    const rule = missRulePool(POOL, 1n);
    if (!rule.ok) throw new Error("fixture must qualify");
    expect(missRuleReading(rule.spec)).toBe("SPOTTER reads this as 1 night at 7+ hours of sleep.");
    const gym = missRulePool({ ...POOL, goalSpec: "Hit the gym 2 times" }, 1n);
    if (!gym.ok) throw new Error("fixture must qualify");
    expect(missRuleReading(gym.spec)).toBe("SPOTTER reads this as 2 workouts.");
  });
});
