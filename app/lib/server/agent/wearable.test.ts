import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Address } from "viem";

// The wearable evidence source classifies the goal into a metric, reads THAT
// metric, and derives a deterministic verdict. Pinned here: the goal->metric
// classification across steps/sleep/workouts/distance/calories (and the
// fail-closed "unmappable" case), the verdict shapes (not connected /
// unmappable / connected-but-not-synced / met / short / outage), and that the
// read is routed on the classified metric scoped to the pool window - so a
// steps goal is never judged on sleep.

const isConnected = vi.fn();
const getMetricProgress = vi.fn();

vi.mock("@/lib/server/junction", () => ({
  isConnected: (...args: unknown[]) => isConnected(...args),
  getMetricProgress: (...args: unknown[]) => getMetricProgress(...args),
}));

const { wearableEvidenceSource, classifyWearableGoal, junctionReadQuote } =
  await import("@/lib/server/agent/wearable");

const USER = "0x1111111111111111111111111111111111111111" as Address;
// 2025-06-15T15:06:40Z .. 2025-06-22T15:06:40Z
const WINDOW = {
  address: USER,
  periodStart: 1_750_000_000n,
  periodEnd: 1_750_604_800n,
};

function metricProgress(qualifyingDays: number, daysWithData = qualifyingDays) {
  return { qualifyingDays, daysWithData };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("junctionReadQuote", () => {
  it("always quotes prepaid - Junction is metered, never an invented payment", () => {
    expect(junctionReadQuote()).toEqual({
      service: "junction-read",
      label: "wearable summary (Junction)",
      estUsd: "0.01",
      url: null,
    });
  });
});

describe("classifyWearableGoal", () => {
  it("routes a steps goal to the steps metric, not sleep", () => {
    expect(classifyWearableGoal("walk 8000 steps a day for a week")).toEqual({
      metric: "steps",
      threshold: 8000,
      goalDays: 7,
      unit: "steps",
      label: "steps",
    });
    expect(classifyWearableGoal("8k steps").metric).toBe("steps");
    expect(classifyWearableGoal("8k steps").threshold).toBe(8000);
  });

  it("routes distance goals to distance_km, converting miles", () => {
    const km = classifyWearableGoal("run 5km 3 times a week");
    expect(km.metric).toBe("distance_km");
    expect(km.threshold).toBe(5);
    expect(km.goalDays).toBe(3);

    const miles = classifyWearableGoal("go for a 3 mile run");
    expect(miles.metric).toBe("distance_km");
    expect(miles.threshold).toBeCloseTo(4.83, 2);
  });

  it("routes sleep-duration goals to sleep_hours", () => {
    expect(
      classifyWearableGoal("sleep 7 hours every night for 7 days"),
    ).toMatchObject({ metric: "sleep_hours", threshold: 7, goalDays: 7 });
    expect(classifyWearableGoal("get 8 hrs of sleep").threshold).toBe(8);
  });

  it("routes sleep-score goals to sleep_score, ignoring an unrelated trailing number", () => {
    expect(classifyWearableGoal("sleep score 80 for 5 days")).toMatchObject({
      metric: "sleep_score",
      threshold: 80,
      goalDays: 5,
    });
    expect(
      classifyWearableGoal("hit an 85+ sleep score for 3 nights"),
    ).toMatchObject({ metric: "sleep_score", threshold: 85, goalDays: 3 });
    // A bare "sleep" goal stays sleep_score at the default threshold.
    expect(classifyWearableGoal("just sleep better")).toMatchObject({
      metric: "sleep_score",
      threshold: 75,
      goalDays: 7,
    });
  });

  it("routes workout/run goals with no distance to a workout-count metric", () => {
    expect(classifyWearableGoal("work out 4 times this week")).toMatchObject({
      metric: "workouts",
      threshold: 1,
      goalDays: 4,
    });
    expect(
      classifyWearableGoal("go for a run every day for a week"),
    ).toMatchObject({ metric: "workouts", threshold: 1, goalDays: 7 });
  });

  it("routes calorie goals to active_calories", () => {
    expect(classifyWearableGoal("burn 500 calories a day")).toMatchObject({
      metric: "active_calories",
      threshold: 500,
    });
  });

  it("returns metric null for a goal no wearable can check", () => {
    expect(classifyWearableGoal("drink more water").metric).toBeNull();
    expect(classifyWearableGoal("call my mom every day").metric).toBeNull();
  });
});

describe("wearableEvidenceSource", () => {
  it("fails closed without touching Junction when the goal maps to no metric", async () => {
    const poll = wearableEvidenceSource(WINDOW);
    const result = await poll("wearable-1750000000", "drink more water");

    expect(result.status).toBe("failed");
    expect(result.verdict).toMatchObject({ verified: false, confidence: "low" });
    expect(result.verdict?.reason).toMatch(
      /could not tell which wearable metric/,
    );
    expect(isConnected).not.toHaveBeenCalled();
    expect(getMetricProgress).not.toHaveBeenCalled();
  });

  it("fails unverified when no wearable is connected", async () => {
    isConnected.mockResolvedValue(false);
    const poll = wearableEvidenceSource(WINDOW);

    const result = await poll(
      "wearable-1750000000",
      "walk 8000 steps a day for 7 days",
    );

    expect(result).toEqual({
      status: "failed",
      verdict: {
        verified: false,
        confidence: "low",
        reason:
          "No wearable is connected for this wallet. Connect one from the dashboard and run the check again.",
      },
    });
    expect(getMetricProgress).not.toHaveBeenCalled();
  });

  it("routes the read on the classified metric, scoped to the pool window", async () => {
    isConnected.mockResolvedValue(true);
    getMetricProgress.mockResolvedValue(metricProgress(7));
    const poll = wearableEvidenceSource(WINDOW);

    await poll("wearable-1750000000", "walk 8000 steps a day for 5 days");

    expect(getMetricProgress).toHaveBeenCalledWith(
      USER,
      "steps",
      8000,
      "2025-06-15",
      "2025-06-22",
    );
  });

  it("treats connected-but-not-synced as syncing (low confidence), not a missed goal", async () => {
    isConnected.mockResolvedValue(true);
    getMetricProgress.mockResolvedValue(metricProgress(0, 0));
    const poll = wearableEvidenceSource(WINDOW);

    const result = await poll(
      "wearable-1750000000",
      "walk 8000 steps a day for 7 days",
    );

    expect(result.status).toBe("failed");
    expect(result.verdict).toMatchObject({ verified: false, confidence: "low" });
    expect(result.verdict?.reason).toMatch(/has not synced any steps data/);
  });

  it("verifies a met goal at high confidence, naming the metric", async () => {
    isConnected.mockResolvedValue(true);
    getMetricProgress.mockResolvedValue(metricProgress(7));
    const poll = wearableEvidenceSource(WINDOW);

    const result = await poll(
      "wearable-1750000000",
      "walk 8000 steps a day for 7 days",
    );

    expect(result.status).toBe("completed");
    expect(result.verdict).toMatchObject({ verified: true, confidence: "high" });
    expect(result.verdict?.reason).toContain("8000+ steps");
    expect(result.verdict?.reason).toContain("7-day goal");
  });

  it("reports a short streak honestly, unverified at high confidence (data existed)", async () => {
    isConnected.mockResolvedValue(true);
    getMetricProgress.mockResolvedValue(metricProgress(3, 5));
    const poll = wearableEvidenceSource(WINDOW);

    const result = await poll(
      "wearable-1750000000",
      "walk 8000 steps a day for 7 days",
    );

    expect(result.status).toBe("completed");
    expect(result.verdict).toMatchObject({
      verified: false,
      confidence: "high",
    });
    expect(result.verdict?.reason).toContain("3 of 7");
  });

  it("resolves a Junction outage to a failed unverified verdict, never a throw", async () => {
    isConnected.mockRejectedValue(new Error("Junction /v2/user returned 503"));
    const poll = wearableEvidenceSource(WINDOW);

    const result = await poll(
      "wearable-1750000000",
      "walk 8000 steps a day for 7 days",
    );

    expect(result.status).toBe("failed");
    expect(result.verdict).toMatchObject({ verified: false, confidence: "low" });
    expect(result.verdict?.reason).toMatch(/could not be reached/);
  });
});
