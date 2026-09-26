import { describe, expect, it } from "vitest";
import {
  HOLD_MS,
  INITIAL_HOLD,
  holdReducer,
  isCommitKey,
  justCommitted,
  type HoldAction,
  type HoldState,
} from "./hold-commit";

function run(actions: HoldAction[], from: HoldState = INITIAL_HOLD): HoldState {
  return actions.reduce(holdReducer, from);
}

describe("hold to commit", () => {
  it("defaults to a 1.2s hold", () => {
    expect(HOLD_MS).toBe(1200);
  });

  it("fills the ring in proportion to the hold", () => {
    const s = run([
      { type: "press", now: 1000 },
      { type: "tick", now: 1600 },
    ]);
    expect(s.phase).toBe("holding");
    expect(s.progress).toBeCloseTo(0.5);
  });

  it("commits once the hold reaches 1.2s, and only then", () => {
    const before = run([
      { type: "press", now: 0 },
      { type: "tick", now: 1199 },
    ]);
    expect(before.phase).toBe("holding");
    const after = holdReducer(before, { type: "tick", now: 1200 });
    expect(after).toEqual({ phase: "committed", startedAt: null, progress: 1 });
    expect(justCommitted(before, after)).toBe(true);
  });

  it("clamps progress when a frame lands late", () => {
    const s = run([
      { type: "press", now: 0 },
      { type: "tick", now: 5000 },
    ]);
    expect(s.progress).toBe(1);
    expect(s.phase).toBe("committed");
  });

  it("cancels back to zero when released early", () => {
    const s = run([
      { type: "press", now: 0 },
      { type: "tick", now: 900 },
      { type: "release" },
    ]);
    expect(s).toEqual(INITIAL_HOLD);
  });

  it("starts the clock again on the second press after a cancel", () => {
    const s = run([
      { type: "press", now: 0 },
      { type: "tick", now: 1000 },
      { type: "release" },
      { type: "press", now: 5000 },
      { type: "tick", now: 5600 },
    ]);
    expect(s.phase).toBe("holding");
    expect(s.progress).toBeCloseTo(0.5);
  });

  it("ignores a repeat press while holding (no clock reset)", () => {
    const s = run([
      { type: "press", now: 0 },
      { type: "press", now: 800 },
      { type: "tick", now: 1200 },
    ]);
    expect(s.phase).toBe("committed");
  });

  it("never un-commits and never commits twice", () => {
    const committed = run([{ type: "commit" }]);
    const later = run(
      [{ type: "release" }, { type: "press", now: 10 }, { type: "tick", now: 5000 }, { type: "commit" }],
      committed,
    );
    expect(later).toBe(committed);
    expect(justCommitted(committed, later)).toBe(false);
  });

  it("ignores ticks when nobody is holding", () => {
    expect(run([{ type: "tick", now: 99999 }])).toEqual(INITIAL_HOLD);
  });

  it("commits directly from the keyboard or the tap control", () => {
    const s = holdReducer(INITIAL_HOLD, { type: "commit" });
    expect(justCommitted(INITIAL_HOLD, s)).toBe(true);
    expect(isCommitKey("Enter")).toBe(true);
    expect(isCommitKey(" ")).toBe(true);
    expect(isCommitKey("Tab")).toBe(false);
  });

  it("honours a custom duration", () => {
    const s = run([
      { type: "press", now: 0 },
      { type: "tick", now: 300, durationMs: 600 },
    ]);
    expect(s.progress).toBeCloseTo(0.5);
  });
});
