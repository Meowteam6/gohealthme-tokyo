// How the Run screen is drawn (docs/DESIGN.md, "The run"): which SPOTTER pose
// the clock and the goal call for, what each night pebble looks like, and the
// one big number. Pure and node-tested; the components only render the answer.

import type { SpotterScreenState } from "@/lib/spotter-poses";
import type { WearableMetric } from "@/lib/wearable-goal";
import { formatRunClock, type RunClock, type TallySlot } from "@/lib/game/tally";

/** The run states SPOTTER has a pose for. */
export type RunScene = Extract<
  SpotterScreenState,
  "run-day" | "run-night-sleep" | "run-workout" | "run-steps"
>;

/** After dark, local time: 20:00 to 05:59. */
export const NIGHT_STARTS_HOUR = 20;
export const NIGHT_ENDS_HOUR = 6;

export function isNightHour(localHour: number): boolean {
  const h = ((Math.floor(localHour) % 24) + 24) % 24;
  return h >= NIGHT_STARTS_HOUR || h < NIGHT_ENDS_HOUR;
}

const SLEEP_METRICS: ReadonlySet<WearableMetric> = new Set([
  "sleep_score",
  "sleep_efficiency",
  "sleep_hours",
]);

export function isSleepMetric(metric: WearableMetric | null): boolean {
  return metric !== null && SLEEP_METRICS.has(metric);
}

/**
 * SPOTTER's pose follows the goal and the clock. A sleep run after dark puts
 * him to bed in the night panel; any run by day has him keeping watch; a
 * workout goal lifts, a step or distance goal runs, whatever the hour. An
 * ended run is always "watching": the night is over, the verdict is next.
 */
export function runSceneOf(input: {
  metric: WearableMetric | null;
  localHour: number;
  ended: boolean;
}): RunScene {
  const { metric } = input;
  if (metric === "workouts" || metric === "active_calories") return "run-workout";
  if (metric === "steps" || metric === "distance_km") return "run-steps";
  if (!input.ended && isSleepMetric(metric) && isNightHour(input.localHour)) {
    return "run-night-sleep";
  }
  return "run-day";
}

export interface Pebble {
  /** gold = banked, outline = still to play, grey = can no longer count. */
  fill: "gold" | "outline" | "grey";
  /** Spoken per pebble, so the count never lives in colour alone. */
  label: string;
}

export function pebbleOf(slot: TallySlot): Pebble {
  switch (slot) {
    case "banked":
      return { fill: "gold", label: "banked" };
    case "open":
      return { fill: "outline", label: "still to play" };
    case "dead":
      return { fill: "grey", label: "can no longer count" };
  }
}

/** The one big number on the Run, and the words under it. */
export interface RunFigure {
  figure: string;
  caption: string;
}

export function runFigureOf(clock: RunClock | null): RunFigure {
  if (clock === null) return { figure: "--", caption: "Reading the clock" };
  if (clock.ended) return { figure: "Ended", caption: "Time is up. The verdict is next." };
  if (clock.notStarted) {
    return { figure: formatRunClock(clock), caption: "until the run closes. It has not started yet." };
  }
  return { figure: formatRunClock(clock), caption: "left in the run" };
}
