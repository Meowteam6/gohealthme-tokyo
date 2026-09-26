import { describe, expect, it } from "vitest";
import { isNightHour, pebbleOf, runFigureOf, runSceneOf } from "@/lib/game/run-scene";
import { nightTally, runClock } from "@/lib/game/tally";

describe("isNightHour", () => {
  it("is night from 20:00 to 05:59", () => {
    expect([20, 21, 23, 0, 3, 5].every(isNightHour)).toBe(true);
    expect([6, 9, 12, 19].some(isNightHour)).toBe(false);
  });
  it("wraps out-of-range hours", () => {
    expect(isNightHour(24)).toBe(true);
    expect(isNightHour(-1)).toBe(true);
    expect(isNightHour(36)).toBe(false);
  });
});

describe("runSceneOf", () => {
  it("puts SPOTTER to bed after dark on a sleep goal", () => {
    for (const metric of ["sleep_hours", "sleep_score", "sleep_efficiency"] as const) {
      expect(runSceneOf({ metric, localHour: 22, ended: false })).toBe("run-night-sleep");
      expect(runSceneOf({ metric, localHour: 14, ended: false })).toBe("run-day");
    }
  });
  it("keeps watch on an ended sleep run, even at night", () => {
    expect(runSceneOf({ metric: "sleep_hours", localHour: 23, ended: true })).toBe("run-day");
  });
  it("lifts on workout goals and runs on step goals, day or night", () => {
    expect(runSceneOf({ metric: "workouts", localHour: 23, ended: false })).toBe("run-workout");
    expect(runSceneOf({ metric: "active_calories", localHour: 9, ended: false })).toBe("run-workout");
    expect(runSceneOf({ metric: "steps", localHour: 23, ended: false })).toBe("run-steps");
    expect(runSceneOf({ metric: "distance_km", localHour: 9, ended: false })).toBe("run-steps");
  });
  it("watches a run with no wearable metric", () => {
    expect(runSceneOf({ metric: null, localHour: 23, ended: false })).toBe("run-day");
  });
});

describe("pebbleOf", () => {
  it("maps every tally slot to a pebble with words", () => {
    expect(pebbleOf("banked")).toEqual({ fill: "gold", label: "banked" });
    expect(pebbleOf("open")).toEqual({ fill: "outline", label: "still to play" });
    expect(pebbleOf("dead")).toEqual({ fill: "grey", label: "can no longer count" });
  });
  it("draws a real tally: one gold, the rest outlined", () => {
    const t = nightTally({ goalDays: 3, banked: 1, periodStart: 0n, periodEnd: 86_400n * 3n, nowSec: 86_400 });
    expect(t?.slots.map((s) => pebbleOf(s).fill)).toEqual(["gold", "outline", "outline"]);
  });
});

describe("runFigureOf", () => {
  it("shows time left while the run is on", () => {
    expect(runFigureOf(runClock(0n, 86_400n, 3_600))).toEqual({ figure: "23h 0m", caption: "left in the challenge" });
  });
  it("says the verdict is next once the clock runs out", () => {
    expect(runFigureOf(runClock(0n, 100n, 200)).figure).toBe("Ended");
  });
  it("never fakes a figure before the clock is read", () => {
    expect(runFigureOf(null).figure).toBe("--");
  });
  it("says so when the run has not started", () => {
    expect(runFigureOf(runClock(1_000n, 90_000n, 0)).caption).toMatch(/not started/);
  });
});
