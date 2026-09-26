import { describe, it, expect } from "vitest";
import {
  PROVIDER_CAPABILITIES,
  LAUNCH_METRICS,
  isLaunchMetric,
  launchGoalsSentence,
  COMING_LINE,
} from "@/lib/provider-capabilities";

describe("provider capabilities", () => {
  it("launch goals are the intersection of every provider", () => {
    const all = Object.values(PROVIDER_CAPABILITIES);
    const expected = all[0].filter((m) => all.every((list) => list.includes(m)));
    expect([...LAUNCH_METRICS].sort()).toEqual([...expected].sort());
  });

  it("is sleep hours, sleep efficiency and workouts today", () => {
    expect([...LAUNCH_METRICS].sort()).toEqual(["sleep_efficiency", "sleep_hours", "workouts"]);
    expect(isLaunchMetric("steps")).toBe(false);
    expect(isLaunchMetric("sleep_score")).toBe(false);
  });

  it("WHOOP cannot measure steps, Apple cannot give a sleep score", () => {
    expect(PROVIDER_CAPABILITIES.whoop).not.toContain("steps");
    expect(PROVIDER_CAPABILITIES.apple).not.toContain("sleep_score");
  });

  it("has plain copy", () => {
    expect(launchGoalsSentence()).toBe("sleep efficiency, hours of sleep or workouts");
    expect(COMING_LINE).toBe("Coming: heart-zone challenges and document proof.");
  });
});
