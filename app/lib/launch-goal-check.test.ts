import { describe, it, expect } from "vitest";
import { launchGoalIssue, LAUNCH_GOAL_EXAMPLES, wearableGoalNotice } from "@/lib/launch-goal-check";
import { classifyWearableGoal } from "@/lib/wearable-goal";

describe("launch goal check", () => {
  it("accepts each launch goal however it is worded", () => {
    for (const goal of [
      "Sleep at least 7 hours for 1 night",
      "Complete at least 1 workout for 1 day",
      "Sleep efficiency 85% or better for 3 nights",
    ]) {
      expect(launchGoalIssue(goal)).toBeNull();
    }
  });

  it("blocks a steps goal and names what is offered", () => {
    const issue = launchGoalIssue("Walk at least 8,000 steps for 1 day");
    expect(issue).toMatch(/every wearable/);
    expect(issue).toMatch(/sleep efficiency, hours of sleep or workouts/);
  });

  it("says challenge, never run", () => {
    expect(launchGoalIssue("Be nicer to people")).toMatch(/^Challenges have to work with every wearable/);
  });

  it("blocks a goal no sensor can read", () => {
    expect(launchGoalIssue("Be nicer to people")).toMatch(/sleep efficiency, hours of sleep or workouts/);
  });

  it("every example chip classifies to a launch goal", () => {
    for (const example of LAUNCH_GOAL_EXAMPLES) {
      expect(classifyWearableGoal(example).metric).not.toBeNull();
      expect(launchGoalIssue(example)).toBeNull();
    }
  });

  it("shows exactly one notice: the launch-goal message wins over the device check", () => {
    expect(wearableGoalNotice("")).toEqual({ kind: "none" });
    expect(wearableGoalNotice("Walk at least 8,000 steps for 1 day")).toMatchObject({ kind: "launch-issue" });
    expect(wearableGoalNotice("Sleep at least 7 hours for 1 night")).toEqual({ kind: "device-check" });
  });
});
