// The hold-to-commit state machine behind HoldCoin (docs/DESIGN.md,
// "Hold to commit"). Pure: time comes in as `now`, so the timing and the
// cancel rules are node-tested without a DOM or a real clock.
//
// Rules:
//   - Pressing starts a hold; progress is elapsed / duration, clamped to 1.
//   - Reaching 1 commits exactly once; nothing afterwards un-commits it.
//   - Releasing (or the pointer leaving) before 1 cancels back to zero.
//   - A direct commit (Enter, Space, "Or tap here to confirm") skips the hold.

export const HOLD_MS = 1200;

export type HoldPhase = "idle" | "holding" | "committed";

export interface HoldState {
  phase: HoldPhase;
  /** ms timestamp the current hold began, null when not holding. */
  startedAt: number | null;
  /** 0 to 1: how much of the ring is filled. */
  progress: number;
}

export type HoldAction =
  | { type: "press"; now: number }
  | { type: "tick"; now: number; durationMs?: number }
  | { type: "release" }
  | { type: "commit" };

export const INITIAL_HOLD: HoldState = { phase: "idle", startedAt: null, progress: 0 };

export function holdReducer(state: HoldState, action: HoldAction): HoldState {
  if (state.phase === "committed") return state;
  switch (action.type) {
    case "press":
      if (state.phase === "holding") return state;
      return { phase: "holding", startedAt: action.now, progress: 0 };
    case "tick": {
      if (state.phase !== "holding" || state.startedAt === null) return state;
      const duration = action.durationMs ?? HOLD_MS;
      const elapsed = Math.max(0, action.now - state.startedAt);
      const progress = duration <= 0 ? 1 : Math.min(1, elapsed / duration);
      if (progress >= 1) return { phase: "committed", startedAt: null, progress: 1 };
      return { ...state, progress };
    }
    case "release":
      return state.phase === "holding" ? INITIAL_HOLD : state;
    case "commit":
      return { phase: "committed", startedAt: null, progress: 1 };
  }
}

/** True when this transition is the one that committed (fire onCommit once). */
export function justCommitted(prev: HoldState, next: HoldState): boolean {
  return prev.phase !== "committed" && next.phase === "committed";
}

/** Keys that commit directly from the keyboard. */
export function isCommitKey(key: string): boolean {
  return key === "Enter" || key === " " || key === "Spacebar";
}
