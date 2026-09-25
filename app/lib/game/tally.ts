// The Run's night-by-night tally and run clock. Pure and node-tested.
//
// The banked count comes from the wearable progress read scoped to the pool's
// period and metric (the same number the streak card showed, now per run), and
// the nights needed from the goal text (classifyWearableGoal). Nothing here
// guesses a night: a night is "banked" only when the progress read counted it.
//
// A "night" is a day of the pool period; sleep goals read naturally as nights,
// and a step goal's day is still one box on the board.

export const DAY_SECONDS = 86_400;

export type TallySlot = "banked" | "open" | "dead";

export type RunStanding =
  /** Enough nights banked for the goal. The verdict is what is left. */
  | "on-target"
  /** Still possible to make it. */
  | "alive"
  /** Not enough nights left to reach the goal. */
  | "out"
  /** The period ended short of the goal. */
  | "over";

export interface NightTally {
  needed: number;
  banked: number;
  nightsTotal: number;
  nightsLeft: number;
  slots: TallySlot[];
  standing: RunStanding;
}

export interface NightTallyInput {
  goalDays: number;
  /** Qualifying days counted so far, or null when the read has not landed. */
  banked: number | null;
  periodStart: bigint;
  periodEnd: bigint;
  nowSec: number;
}

/** Null when there is no count to show (the read has not landed). Never a
 *  fake zero: a zero next to a linked device reads as "you missed every night". */
export function nightTally(input: NightTallyInput): NightTally | null {
  if (input.banked === null) return null;
  const needed = Math.max(1, Math.floor(input.goalDays));
  const banked = Math.max(0, Math.min(needed, Math.floor(input.banked)));
  const start = Number(input.periodStart);
  const end = Number(input.periodEnd);
  const nightsTotal = Math.max(1, Math.ceil((end - start) / DAY_SECONDS));
  const elapsed = Math.min(
    nightsTotal,
    Math.max(0, Math.floor((input.nowSec - start) / DAY_SECONDS)),
  );
  const ended = input.nowSec >= end;
  // Tonight still counts until the period closes.
  const nightsLeft = ended ? 0 : nightsTotal - elapsed;

  const slots: TallySlot[] = [];
  for (let i = 0; i < needed; i++) {
    if (i < banked) slots.push("banked");
    else if (i - banked < nightsLeft) slots.push("open");
    else slots.push("dead");
  }

  const standing: RunStanding =
    banked >= needed
      ? "on-target"
      : ended
        ? "over"
        : banked + nightsLeft < needed
          ? "out"
          : "alive";

  return { needed, banked, nightsTotal, nightsLeft, slots, standing };
}

export interface RunClock {
  ended: boolean;
  notStarted: boolean;
  days: number;
  hours: number;
  minutes: number;
}

/** Time left in the run, as whole units for the scoreboard. */
export function runClock(
  periodStart: bigint,
  periodEnd: bigint,
  nowSec: number,
): RunClock {
  const start = Number(periodStart);
  const end = Number(periodEnd);
  const left = Math.max(0, end - nowSec);
  return {
    ended: nowSec >= end,
    notStarted: nowSec < start,
    days: Math.floor(left / DAY_SECONDS),
    hours: Math.floor((left % DAY_SECONDS) / 3600),
    minutes: Math.floor((left % 3600) / 60),
  };
}

/** "2d 5h", "5h 12m", "12m", "Ended". */
export function formatRunClock(clock: RunClock): string {
  if (clock.ended) return "Ended";
  if (clock.days > 0) return `${clock.days}d ${clock.hours}h`;
  if (clock.hours > 0) return `${clock.hours}h ${clock.minutes}m`;
  return `${Math.max(1, clock.minutes)}m`;
}

/** The tally in words, next to the boxes, so the count never lives in colour. */
export function tallyWords(t: NightTally): string {
  const nightWord = t.needed === 1 ? "night" : "nights";
  return `${t.banked} of ${t.needed} ${nightWord} banked`;
}
