// The run page's words and figures (docs/DESIGN.md, "Run page"): the one big
// figure and its line ("7 hours" / "of sleep, Saturday night"), the end time,
// the Your night timeline, the stake terms, the solo and friend lines, and the
// result's calendar file. Pure, so each sentence is tested with exact numbers.
//
// Every money figure comes from lib/commitment.ts, which mirrors
// HealthPoolsV3._settleCommitment. Nothing here does its own payout math, and
// a number that cannot be stood behind (the fee did not read) is not shown.

import { commitmentOutcome, commitmentRange } from "@/lib/commitment";
import { formatUsdc } from "@/lib/contract";
import { classifyWearableGoal, type WearableMetric } from "@/lib/wearable-goal";
import { sponsorPotOf, type CommitmentTerms } from "@/lib/game/commitment-copy";

const HOUR = 3600;

// ------------------------------------------------------------- time labels

function parts(sec: number, timeZone?: string) {
  const date = new Date(sec * 1000);
  const weekdayLong = date.toLocaleDateString("en-US", { weekday: "long", timeZone });
  const weekdayShort = date.toLocaleDateString("en-US", { weekday: "short", timeZone });
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone });
  return { weekdayLong, weekdayShort, time };
}

/** "08:30", 24-hour, in the viewer's zone (or the one given). */
export function clockLabel(sec: number, timeZone?: string): string {
  return parts(sec, timeZone).time;
}

/** "Sun 08:30": the run's end, day and time. */
export function endsLabel(periodEnd: bigint, timeZone?: string): string {
  const p = parts(Number(periodEnd), timeZone);
  return `${p.weekdayShort} ${p.time}`;
}

/** "08:30 on Sunday": the close, for sentences. */
export function closeLabelOf(periodEnd: bigint, timeZone?: string): string {
  const p = parts(Number(periodEnd), timeZone);
  return `${p.time} on ${p.weekdayLong}`;
}

/** True when the run closes within a day: the tag says tonight or today. */
export function closesWithinDay(periodEnd: bigint, nowSec: number): boolean {
  const left = Number(periodEnd) - nowSec;
  return left > 0 && left <= 86_400;
}

/** "16h 40m", "2d 5h", "12m": time left, or null once the run has ended. */
export function leftLabel(periodEnd: bigint, nowSec: number): string | null {
  const left = Number(periodEnd) - nowSec;
  if (left <= 0) return null;
  const days = Math.floor(left / 86_400);
  const hours = Math.floor((left % 86_400) / HOUR);
  const minutes = Math.floor((left % HOUR) / 60);
  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${String(minutes).padStart(2, "0")}m`;
  return `${Math.max(1, minutes)}m`;
}

// ------------------------------------------------------------ the headline

const SLEEP_METRICS: readonly WearableMetric[] = ["sleep_hours", "sleep_efficiency", "sleep_score"];

export function isSleepMetric(metric: WearableMetric | null): boolean {
  return metric !== null && SLEEP_METRICS.includes(metric);
}

function trimNumber(n: number): string {
  return Number.isInteger(n) ? n.toLocaleString("en-US") : String(Math.round(n * 100) / 100);
}

export interface RunHeadline {
  /** The one big figure, set in Figtree: "7 hours", "8,000 steps", "85%".
   *  Null when the goal is not a wearable number (a document run): the page
   *  sets the goal text as the headline instead. */
  figure: string | null;
  /** The line under it, set in Fraunces: "of sleep, Saturday night". */
  rest: string;
  /** The figure as a noun phrase for sentences: "7 hours", "85% efficiency". */
  short: string;
  metric: WearableMetric | null;
  /** Per-day threshold in the metric's unit; 0 for a document run. */
  threshold: number;
  goalDays: number;
}

/**
 * The headline for a run, read from its goal text and period. A one-night
 * sleep run is named by the night it ends in the morning of ("Saturday
 * night"); a one-day run by the day it belongs to; a longer run by its count.
 */
export function runHeadlineOf(input: {
  goalSpec: string;
  periodEnd: bigint;
  timeZone?: string;
}): RunHeadline {
  const spec = classifyWearableGoal(input.goalSpec);
  const end = Number(input.periodEnd);
  const sleep = isSleepMetric(spec.metric);
  // A one-day run belongs to the day before a morning close, whatever it
  // counts: a workout run that closes Sun 08:00 is Saturday's, the day the
  // lobby calls "today" and the one SPOTTER's window opens on. 12 hours back
  // lands on that evening for any morning close, and on the same day for an
  // afternoon or evening one. A sleep run is that day's night.
  const day = parts(end - 12 * HOUR, input.timeZone).weekdayLong;
  const when =
    spec.goalDays === 1
      ? sleep
        ? `${day} night`
        : day
      : `on ${spec.goalDays} ${sleep ? "nights" : "days"}`;
  const t = spec.threshold;
  const base = { metric: spec.metric, threshold: t, goalDays: spec.goalDays };
  switch (spec.metric) {
    case "sleep_hours": {
      const figure = `${trimNumber(t)} ${t === 1 ? "hour" : "hours"}`;
      return { ...base, figure, rest: `of sleep, ${when}`, short: figure };
    }
    case "sleep_efficiency":
      return { ...base, figure: `${trimNumber(t)}%`, rest: `sleep efficiency, ${when}`, short: `${trimNumber(t)}% efficiency` };
    case "sleep_score":
      return { ...base, figure: trimNumber(t), rest: `sleep score, ${when}`, short: `a ${trimNumber(t)} sleep score` };
    case "steps": {
      const figure = `${trimNumber(t)} steps`;
      return { ...base, figure, rest: when, short: figure };
    }
    case "distance_km": {
      const figure = `${trimNumber(t)} km`;
      return { ...base, figure, rest: when, short: figure };
    }
    case "active_calories":
      return { ...base, figure: trimNumber(t), rest: `active calories, ${when}`, short: `${trimNumber(t)} active calories` };
    case "workouts": {
      const figure = `${trimNumber(t)} ${t === 1 ? "workout" : "workouts"}`;
      return { ...base, figure, rest: when, short: figure };
    }
    default:
      return { ...base, figure: null, rest: "", short: "the goal" };
  }
}

// ------------------------------------------------------------ Your night

export interface NightTimeline {
  /** The latest you can fall asleep and still fit the hours, unix seconds. */
  latestSec: number;
  /** Where "latest asleep" sits on the now-to-check rail, 0 to 100. */
  latestPct: number;
  /** False once fewer hours are left than the goal needs. */
  fits: boolean;
}

/**
 * The Your night rail for an hours-of-sleep run: now on the left, the check at
 * the run's end on the right, and the sleep block ending at the check. Null
 * for any other goal, and once the run has ended.
 */
export function nightTimelineOf(input: {
  nowSec: number;
  periodEnd: bigint;
  goalHours: number;
}): NightTimeline | null {
  const end = Number(input.periodEnd);
  if (input.nowSec >= end || input.goalHours <= 0) return null;
  const latestSec = end - Math.round(input.goalHours * HOUR);
  const span = end - input.nowSec;
  const pct = ((latestSec - input.nowSec) / span) * 100;
  return {
    latestSec,
    latestPct: Math.max(0, Math.min(100, pct)),
    fits: latestSec >= input.nowSec,
  };
}

// ------------------------------------------------------------ stake terms

export interface StakeTermsCopy {
  hitLabel: string;
  hit: string;
  miss: string;
  nobody: string;
}

/**
 * The three outcomes under the stake, with the run's own numbers. Worded as
 * COMMITMENT_FACTS words them; the fee sentence only when the fee read. A run
 * that cannot record a miss (lib/miss-rule.ts) never promises a missed stake:
 * a miss there is refunded at settle, so a hit is the stake plus any pot.
 */
export function stakeTermsOf(input: {
  entryFee: bigint;
  sponsorPot: bigint;
  goalShort: string;
  feeBps: number | null;
  recordsMisses: boolean;
}): StakeTermsCopy {
  const stake = formatUsdc(input.entryFee);
  const pot = input.sponsorPot > 0n ? ` and the ${formatUsdc(input.sponsorPot)} extra in the pot` : "";
  const fee =
    input.feeBps === null
      ? ""
      : input.feeBps === 0
        ? " No cut on this build."
        : ` GoHealthMe keeps ${(input.feeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}% of missed stakes.`;
  const hitLabel = input.goalShort === "the goal" ? "Hit it:" : `Hit ${input.goalShort}:`;
  if (!input.recordsMisses) {
    return {
      hitLabel,
      hit:
        input.sponsorPot > 0n
          ? `your ${stake} back, plus an equal share of the ${formatUsdc(input.sponsorPot)} extra in the pot.`
          : `your ${stake} back.`,
      miss: `this challenge cannot record a miss, so your ${stake} comes back when it settles.`,
      nobody: "everyone's stake comes back.",
    };
  }
  return {
    hitLabel,
    hit: `your ${stake} back, plus an equal share of the missed stakes${pot}.`,
    // Both halves of the rule, at the moment of commitment: only a miss the
    // wearable shows costs the stake; no data for the run is not a miss.
    miss: `if your wearable shows it, your ${stake} goes to the players who hit. If your wearable sends nothing for the challenge, it comes back.`,
    nobody: `everyone's stake comes back.${fee}`,
  };
}

export type SoloLine =
  | { kind: "first"; total: string; stake: string; pot: string | null }
  | { kind: "range"; players: number; low: string; high: string }
  /** Others are in, and a hit pays the same however many hit: a run that
   *  cannot record a miss and has no sponsor pot. */
  | { kind: "flat"; players: number; total: string };

/**
 * What a hit pays for someone about to join: alone in an empty run, or the
 * range from everyone hitting to only them. Null when the fee did not read.
 */
export function soloLineOf(t: CommitmentTerms): SoloLine | null {
  if (t.feeBps === null) return null;
  const sponsorPot = sponsorPotOf(t);
  if (t.players === 0) {
    const alone = commitmentOutcome({
      entryFee: t.entryFee,
      players: 1,
      achievers: 1,
      sponsorPot,
      feeBps: t.feeBps,
    });
    const total = alone.kind === "paid" ? alone.perAchiever : alone.refundEach;
    return {
      kind: "first",
      total: formatUsdc(total),
      stake: formatUsdc(t.entryFee),
      pot: sponsorPot > 0n ? formatUsdc(sponsorPot) : null,
    };
  }
  const range = commitmentRange({
    entryFee: t.entryFee,
    players: t.players,
    sponsorPot,
    feeBps: t.feeBps,
    includeJoiner: true,
    recordsMisses: t.recordsMisses,
  });
  if (range.ifEveryone === range.ifOnlyYou) {
    return { kind: "flat", players: t.players, total: formatUsdc(range.ifOnlyYou) };
  }
  return {
    kind: "range",
    players: t.players,
    low: formatUsdc(range.ifEveryone),
    high: formatUsdc(range.ifOnlyYou),
  };
}

/**
 * The two-player math for bringing a friend, only when it is exact: the run
 * holds nobody but you (or nobody yet). With others in, their nights change
 * the split, so no number is promised. Null otherwise, or without the fee.
 */
export function friendMathOf(
  t: CommitmentTerms,
  youAreIn: boolean,
): { bothHit: string; friendMisses: string } | null {
  if (t.feeBps === null) return null;
  const others = t.players - (youAreIn ? 1 : 0);
  if (others !== 0) return null;
  const base = { entryFee: t.entryFee, players: 2, sponsorPot: sponsorPotOf(t), feeBps: t.feeBps };
  const both = commitmentOutcome({ ...base, achievers: 2 });
  // On a run that cannot record a miss, the friend's miss is refunded before
  // the split (HealthPoolsV3 B-2), so only you are in it.
  const one = commitmentOutcome(t.recordsMisses ? { ...base, achievers: 1 } : { ...base, players: 1, achievers: 1 });
  if (both.kind !== "paid" || one.kind !== "paid") return null;
  // Nothing to promise when a friend's miss changes nothing for you.
  if (both.perAchiever === one.perAchiever) return null;
  return { bothHit: formatUsdc(both.perAchiever), friendMisses: formatUsdc(one.perAchiever) };
}

/**
 * A paid result split the way commitmentOutcome splits it: the stake back,
 * and the rest from missed stakes and any sponsor pot. Null when the ledger's
 * figure does not parse or is below the stake.
 */
export function paidSplitOf(paidUsd: string, entryFee: bigint): { stake: string; rest: string } | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(paidUsd.trim());
  if (match === null) return null;
  const paid = BigInt(match[1]) * 1_000_000n + BigInt((match[2] ?? "").padEnd(6, "0"));
  if (paid < entryFee) return null;
  return { stake: formatUsdc(entryFee), rest: formatUsdc(paid - entryFee) };
}

/**
 * The paid verdict's share text. The contract paid, not SPOTTER, and the
 * stake coming back is not winnings: the line splits the figure the way the
 * receipt does. Falls back to the total when the figure does not split.
 */
export function paidShareText(paidUsd: string, entryFee: bigint, goalShort: string): string {
  const goal = goalShort === "the goal" ? "my goal" : goalShort;
  const split = paidSplitOf(paidUsd, entryFee);
  if (split === null) return `I hit ${goal} on GoHealthMe and got ${paidUsd} back, in test USDC. Put money on yourself.`;
  if (split.rest === "0.00") return `I hit ${goal} on GoHealthMe: my ${split.stake} back, in test USDC. Put money on yourself.`;
  return `I hit ${goal} on GoHealthMe: my ${split.stake} back plus ${split.rest} from the pot, in test USDC. Put money on yourself.`;
}

// ---------------------------------------------------------- calendar file

function icsStamp(sec: number): string {
  return new Date(sec * 1000).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
}

/**
 * A one-event calendar file for the run's close, so the phone does the
 * reminding and no server job is needed. The body says the one thing the
 * player has to do: sync, then send SPOTTER in.
 */
export function resultIcs(input: {
  poolId: bigint;
  periodEnd: bigint;
  title: string;
  deviceName: string;
  nowSec: number;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//GoHealthMe//Run//EN",
    "BEGIN:VEVENT",
    `UID:pool-${input.poolId.toString()}-close@gohealthme`,
    `DTSTAMP:${icsStamp(input.nowSec)}`,
    `DTSTART:${icsStamp(Number(input.periodEnd))}`,
    "DURATION:PT15M",
    `SUMMARY:Have SPOTTER check: ${input.title.replace(/[\r\n,;]/g, " ")}`,
    `DESCRIPTION:Open your ${input.deviceName.replace(/[\r\n,;]/g, " ")} app so the night syncs\\, then send SPOTTER in to check.`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return lines.join("\r\n");
}
