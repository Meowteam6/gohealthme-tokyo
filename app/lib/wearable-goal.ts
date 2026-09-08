// Classifying a pool's free-form goal text into the metric it is actually
// about. Isomorphic on purpose: the SERVER needs it to decide a verdict, and
// the BROWSER needs it to tell someone their device cannot verify a pool
// BEFORE they stake on it. It lived in a server module and so could only ever
// answer the first question, which is why a WHOOP wallet could join a steps
// pool and only find out at claim time that a strap has no pedometer.
//
// Pure text parsing, no imports, no I/O - safe in a client bundle.

export type WearableMetric =
  | "sleep_score"
  | "sleep_efficiency"
  | "sleep_hours"
  | "steps"
  | "active_calories"
  | "distance_km"
  | "workouts";

// WHY sleep_score AND sleep_efficiency ARE TWO METRICS
//
// They are both 0-100 and they measure different things. Efficiency is asleep
// time over time in bed and sits around 85-95 for an ordinary sleeper. A
// proprietary sleep score (WHOOP's sleep performance, Oura's sleep score) is
// weighted by need and recovery and runs materially lower.
//
// This module used to collapse them: recScore read `score ?? efficiency ??
// sleep_efficiency`, so a device that reported no score was silently judged on
// efficiency instead. Two people in the same pool, holding the same stake,
// were being paid against different bars and neither was told. Splitting the
// metric is what lets a provider say honestly which one it can measure, and
// lets the pool list refuse a mismatch before anyone stakes.

/**
 * A goal classified into the wearable metric it is actually about, with the
 * per-day threshold and the number of qualifying days needed.
 *
 * metric === null means the goal cannot be checked from a wearable, so the
 * verdict fails closed and never pays - the alternative (guessing a metric)
 * pays or denies real USDC on the wrong measurement.
 */
/** Days a goal needs when its text does not say. */
export const DEFAULT_GOAL_DAYS = 7;
/** Sleep-score threshold when a goal does not name one. */
export const DEFAULT_THRESHOLD = 75;

export interface WearableSpec {
  metric: WearableMetric | null;
  /** Per-day target value, in the metric's own unit. */
  threshold: number;
  /** Qualifying days needed inside the pool period. */
  goalDays: number;
  /** Unit for the verdict reason ("steps", "hours of sleep", "km", ...). */
  unit: string;
  /** Short human name of the metric for copy ("steps", "sleep", ...). */
  label: string;
}

/**
 * Days the goal must be hit. Reads "for 7 days" / "5 nights" / "7-day", a
 * "3 times" / "4x" count (that many qualifying days), or a "week"/"month"
 * cadence. Falls back to a 7-day week.
 */
function parseGoalDays(goalSpec: string): number {
  const text = goalSpec.toLowerCase();
  const dayMatch = /(\d+)[\s-]*(?:day|night)/.exec(text);
  if (dayMatch) {
    const n = Number(dayMatch[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 60) return n;
  }
  const timesMatch = /(\d+)\s*(?:x|times)\b/.exec(text);
  if (timesMatch) {
    const n = Number(timesMatch[1]);
    if (Number.isInteger(n) && n >= 1 && n <= 60) return n;
  }
  if (/\bmonth\b/.test(text)) return 30;
  if (/\bweek\b/.test(text)) return 7;
  return DEFAULT_GOAL_DAYS;
}

/**
 * Classify a pool's free-form goal text into the wearable metric it measures,
 * plus the per-day threshold and qualifying-day count. Deterministic keyword +
 * number matching over the common health goals; anything it cannot confidently
 * map returns metric: null so the verdict fails closed rather than guessing.
 */
export function classifyWearableGoal(goalSpec: string): WearableSpec {
  const text = goalSpec.toLowerCase();
  const goalDays = parseGoalDays(goalSpec);

  // STEPS - "8000 steps", "8k steps", "8,000 steps a day".
  if (/\bsteps?\b/.test(text)) {
    let threshold = 8000;
    const m = /(\d[\d,]*)\s*(k?)\s*steps?/.exec(text);
    if (m) {
      let v = Number(m[1].replace(/,/g, ""));
      if (m[2] === "k") v *= 1000;
      if (Number.isFinite(v) && v >= 100 && v <= 200000) threshold = v;
    }
    return { metric: "steps", threshold, goalDays, unit: "steps", label: "steps" };
  }

  // DISTANCE - a run/ride/swim/walk with an explicit km or mile figure.
  const dist = /(\d+(?:\.\d+)?)\s*(km|kilometers?|kilometres?|miles?|mi)\b/.exec(
    text,
  );
  if (
    dist !== null &&
    /\b(run|ran|running|jog|jogs|jogged|jogging|cycle|cycling|bike|biking|ride|riding|swim|swims|swimming|walk|walked|walking|distance)\b/.test(
      text,
    )
  ) {
    let v = Number(dist[1]);
    if (/mile|mi\b/.test(dist[2])) v *= 1.60934; // miles -> km
    v = Math.round(v * 100) / 100;
    return {
      metric: "distance_km",
      threshold: v,
      goalDays,
      unit: "km",
      label: "distance",
    };
  }

  // SLEEP - duration ("sleep 7 hours").
  if (/\bsleep\b/.test(text) && /\b(hours?|hrs?)\b/.test(text)) {
    let threshold = 7;
    const m = /(\d+(?:\.\d+)?)\s*(?:hours?|hrs?)/.exec(text);
    if (m) {
      const v = Number(m[1]);
      if (Number.isFinite(v) && v >= 1 && v <= 16) threshold = v;
    }
    return {
      metric: "sleep_hours",
      threshold,
      goalDays,
      unit: "hours of sleep",
      label: "sleep",
    };
  }

  // SLEEP - efficiency, score, or a bare "sleep" goal.
  //
  // Efficiency and score are SEPARATE metrics even though both are 0-100.
  // Efficiency is asleep over in-bed and runs 85-95 for an ordinary sleeper; a
  // proprietary sleep score runs materially lower. Reading one as the other
  // holds two people in the same pool to different bars, so the word the pool
  // author wrote decides, and a device that cannot produce that number is
  // refused at the join rather than judged on a substitute.
  //
  // A bare "sleep" goal with no metric word stays sleep_score, which is what
  // it has always meant - live pools were authored under that reading and must
  // not change meaning underneath their participants.
  if (/\bsleep\b/.test(text)) {
    const efficiency = /\befficiency\b/.test(text);
    let threshold = efficiency ? 90 : 75;
    const m =
      /(?:score|efficiency)\s*(?:of|>=|at least|above)?\s*(\d{1,3})/.exec(
        text,
      ) ?? /(\d{1,3})\s*\+/.exec(text);
    if (m) {
      const v = Number(m[1]);
      if (Number.isInteger(v) && v >= 1 && v <= 100) threshold = v;
    }
    return efficiency
      ? {
          metric: "sleep_efficiency",
          threshold,
          goalDays,
          unit: "% sleep efficiency",
          label: "sleep efficiency",
        }
      : {
          metric: "sleep_score",
          threshold,
          goalDays,
          unit: "sleep score",
          label: "sleep",
        };
  }

  // WORKOUTS / EXERCISE / RUNS-RIDES-SWIMS without a distance: a day qualifies
  // when at least one session happened; the "N times" count is the day count.
  if (
    /\b(workout|workouts|work out|exercise|exercises|gym|train|training|trained|lift|lifting|run|ran|running|jog|jogged|jogging|cycle|cycling|bike|biking|ride|riding|swim|swims|swimming|session|sessions|hiit|yoga|pilates)\b/.test(
      text,
    )
  ) {
    return {
      metric: "workouts",
      threshold: 1,
      goalDays,
      unit: "workout",
      label: "workout",
    };
  }

  // ACTIVE CALORIES.
  if (/\b(calories?|kcal)\b/.test(text)) {
    let threshold = 500;
    const m = /(\d[\d,]*)\s*(?:calories?|kcal)/.exec(text);
    if (m) {
      const v = Number(m[1].replace(/,/g, ""));
      if (Number.isFinite(v) && v >= 50 && v <= 20000) threshold = v;
    }
    return {
      metric: "active_calories",
      threshold,
      goalDays,
      unit: "active calories",
      label: "calories",
    };
  }

  // Not verifiable from a wearable - fail closed.
  return { metric: null, threshold: 0, goalDays, unit: "", label: "" };
}
