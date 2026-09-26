import { afterEach, describe, it, expect, vi, beforeEach } from "vitest";
import type { Address } from "viem";

// The wearable evidence source classifies the goal into a metric, reads THAT
// metric, and derives a deterministic verdict. Pinned here: the goal->metric
// classification across steps/sleep/workouts/distance/calories (and the
// fail-closed "unmappable" case), the verdict shapes (not connected /
// unmappable / connected-but-not-synced / met / short / outage), and that the
// read is routed on the classified metric scoped to the pool window - so a
// steps goal is never judged on sleep. Also pinned: a metric the
// participant's OWN provider cannot measure fails closed too - WHOOP has no
// step count, and reading zero would tell somebody who walked 12,000 steps
// that they missed the goal.

const isConnected = vi.fn();
const getMetricProgress = vi.fn();
const providerFor = vi.fn();

vi.mock("@/lib/server/wearable", () => ({
  providerFor: (...args: unknown[]) => providerFor(...args),
}));

const { wearableEvidenceSource, classifyWearableGoal, wearableReadQuote } =
  await import("@/lib/server/agent/wearable");

const ALL_METRICS = [
  "sleep_score",
  "sleep_hours",
  "steps",
  "active_calories",
  "distance_km",
  "workouts",
];

/** A stub provider standing in for whichever integration backs the wallet. */
function stubProvider(overrides: Record<string, unknown> = {}) {
  return {
    id: "junction",
    label: "Junction",
    readService: "junction-read",
    readLabel: "wearable summary (Junction)",
    readEstUsd: "0.01",
    metrics: ALL_METRICS,
    isConnected: (...args: unknown[]) => isConnected(...args),
    getMetricProgress: (...args: unknown[]) => getMetricProgress(...args),
    ...overrides,
  };
}

const USER = "0x1111111111111111111111111111111111111111" as Address;
// 2025-06-15T15:06:40Z .. 2025-06-22T15:06:40Z
const WINDOW = {
  address: USER,
  periodStart: 1_750_000_000n,
  periodEnd: 1_750_604_800n,
};

function metricProgress(
  qualifyingDays: number,
  daysWithData = qualifyingDays,
  daysWithSource = daysWithData,
) {
  return { qualifyingDays, daysWithData, daysWithSource };
}

beforeEach(() => {
  vi.clearAllMocks();
  providerFor.mockResolvedValue(stubProvider());
});

describe("wearableReadQuote", () => {
  it("quotes the provider that backs the wallet, always prepaid", async () => {
    expect(await wearableReadQuote(USER)).toEqual({
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
          "No wearable is connected for this wallet. Connect one from the dashboard and check again.",
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

  it("fails closed when the wallet's own provider cannot measure the metric", async () => {
    // WHOOP reports sleep and strain and has no step count at all. Reading
    // zero steps would tell somebody who walked 12,000 that they missed the
    // goal and pay them nothing, so the verdict names the device instead.
    providerFor.mockResolvedValue(
      stubProvider({
        id: "whoop",
        label: "WHOOP",
        readService: "whoop-read",
        metrics: ["sleep_score", "sleep_hours"],
      }),
    );
    const poll = wearableEvidenceSource(WINDOW);

    const result = await poll(
      "wearable-1750000000",
      "walk 8000 steps a day for a week",
    );

    expect(result.status).toBe("failed");
    expect(result.verdict).toMatchObject({ verified: false, confidence: "low" });
    expect(result.verdict?.reason).toContain("WHOOP");
    expect(result.verdict?.reason).toContain("steps");
    // Never even asked: the device cannot answer, so no read is bought.
    expect(isConnected).not.toHaveBeenCalled();
    expect(getMetricProgress).not.toHaveBeenCalled();
  });

  it("still serves a sleep goal on a WHOOP-backed wallet", async () => {
    providerFor.mockResolvedValue(
      stubProvider({
        id: "whoop",
        label: "WHOOP",
        readService: "whoop-read",
        metrics: ["sleep_score", "sleep_hours"],
      }),
    );
    isConnected.mockResolvedValue(true);
    getMetricProgress.mockResolvedValue(metricProgress(7));
    const poll = wearableEvidenceSource(WINDOW);

    const result = await poll(
      "wearable-1750000000",
      "sleep score 75+ for 7 days",
    );

    expect(result.status).toBe("completed");
    expect(result.verdict).toMatchObject({ verified: true, confidence: "high" });
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
  it("separates a device that is still syncing from one that cannot measure it", async () => {
    isConnected.mockResolvedValue(true);
    // Nothing at all has arrived: waiting genuinely fixes this.
    getMetricProgress.mockResolvedValue(metricProgress(0, 0, 0));
    const poll = wearableEvidenceSource(WINDOW);

    const syncing = await poll(
      "wearable-1750000000",
      "sleep score 75+ for 7 days",
    );
    expect(syncing.verdict?.reason).toMatch(/give it a few minutes/i);

    // Six days of records arrived and none of them carried a sleep score. A
    // tracker with no sleep score will not grow one, so "wait a few minutes"
    // would be advice that can never come true.
    getMetricProgress.mockResolvedValue(metricProgress(0, 0, 6));
    const cannotMeasure = await poll(
      "wearable-1750000000",
      "sleep score 75+ for 7 days",
    );
    expect(cannotMeasure.verdict?.reason).toMatch(/does not report/i);
    expect(cannotMeasure.verdict?.reason).not.toMatch(/few minutes/i);
    // Neither pays, and neither blames the user.
    expect(cannotMeasure.verdict?.verified).toBe(false);
    expect(cannotMeasure.status).toBe("failed");
  });
});

// F8 (fix/record-misses review): the pass path read UTC days while the miss
// rule reads the wearer's local calendar, so on live pool 5 (Sat 11:39 to Sun
// 08:30 JST) the pass only ever saw Friday night. Now both read the same
// local window W from the same evidence.
describe("F8: the pass path reads the wearer's local window", () => {
  // Read after the run ended (Sun 2026-09-27 14:30 JST), so Sunday counts.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-27T05:30:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });
  const POOL5 = { address: USER, periodStart: 1_790_390_383n, periodEnd: 1_790_465_400n };
  const tokyo = (values: Record<string, number>) =>
    stubProvider({
      getMissEvidence: vi.fn().mockResolvedValue({
        values,
        heartbeatDays: Object.keys(values),
        sourceDays: Object.keys(values),
        tzOffsetSec: 9 * 3600,
      }),
    });

  it("pays a Saturday-night sleeper on pool 5 in Tokyo", async () => {
    isConnected.mockResolvedValue(true);
    providerFor.mockResolvedValue(tokyo({ "2026-09-26": 6, "2026-09-27": 8 }));
    const result = await wearableEvidenceSource(POOL5)(
      "wearable-1790390383",
      "Sleep at least 7 hours for 1 night",
    );
    expect(result.verdict?.verified).toBe(true);
    expect(getMetricProgress).not.toHaveBeenCalled();
  });

  it("never pays a Friday-only sleeper while refunding a Saturday-only sleeper", async () => {
    isConnected.mockResolvedValue(true);
    const verified = async (values: Record<string, number>) => {
      providerFor.mockResolvedValue(tokyo(values));
      const result = await wearableEvidenceSource(POOL5)(
        "wearable-1790390383",
        "Sleep at least 7 hours for 1 night",
      );
      return result.verdict?.verified === true;
    };
    const fridayOnly = await verified({ "2026-09-26": 8, "2026-09-27": 5 });
    const saturdayOnly = await verified({ "2026-09-26": 6, "2026-09-27": 8 });
    expect(fridayOnly && !saturdayOnly).toBe(false);
    expect(saturdayOnly).toBe(true);
  });
});
