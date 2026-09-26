// The landing's decisions, pure and node-tested: which open runs a visitor
// sees, which one leads the hero, and every sentence that states money. Every
// figure comes from lib/commitment.ts; nothing here does its own payout math.
//
// The visible set mirrors what a signed-out visitor sees in the lobby
// (lib/game/lobby.ts buildLobby): live, payable, not a private challenge, and
// scored by a wearable. The landing only lists wearable runs because its
// "What do you wear?" picker is about wearables; upload runs stay in the lobby.

import { commitmentOutcome, commitmentRange } from "@/lib/commitment";
import { displayGoalSpec, evidenceTypeOf, formatUsdc, type PoolInfo } from "@/lib/contract";
import { sponsorPotOf } from "@/lib/game/commitment-copy";
import { poolCanPay, poolPhase } from "@/lib/pool-lifecycle";
import { classifyWearableGoal, type WearableMetric } from "@/lib/wearable-goal";

/** A run on the landing: the pool plus how many players are in, when read. */
export interface OpenRun {
  pool: PoolInfo;
  /** participantCount, or null while it loads or when the read failed. */
  players: number | null;
}

/** What a run is scored on, for its icon and its tag. */
export type RunKind = "sleep" | "workout" | "move" | "other";

const COMMITMENT_MODEL = 2;

export function runMetric(goalSpec: string): WearableMetric | null {
  return classifyWearableGoal(goalSpec).metric;
}

export function runKind(goalSpec: string): RunKind {
  const metric = runMetric(goalSpec);
  if (metric === null) return "other";
  if (metric.startsWith("sleep")) return "sleep";
  if (metric === "workouts") return "workout";
  return "move";
}

/**
 * The run's name. A public run's `initiative` is its short title ("Sleep 7
 * hours Saturday night"); older runs used it as a one-word tag ("sleep",
 * "flu-shot"), so a tag falls back to the goal text itself.
 */
export function runName(pool: Pick<PoolInfo, "initiative" | "goalSpec">): string {
  const name = pool.initiative.trim();
  if (name === "" || name === "challenge" || !/\s/.test(name)) {
    return displayGoalSpec(pool.goalSpec).trim();
  }
  return name;
}

/**
 * The runs a visitor can see on the landing, soonest ending first. Same
 * visibility rules the lobby applies for a visitor, restricted to wearable
 * runs. `players` is looked up by pool id (decimal string).
 */
export function openLandingRuns(
  pools: readonly PoolInfo[],
  nowSeconds: bigint,
  players: ReadonlyMap<string, number>,
): OpenRun[] {
  return pools
    .filter(
      (p) =>
        poolPhase(p, nowSeconds) === "live" &&
        poolCanPay(p) &&
        p.initiative !== "challenge" &&
        evidenceTypeOf(p.goalSpec) === "wearable",
    )
    .map((pool) => ({ pool, players: players.get(pool.id.toString()) ?? null }))
    .sort((a, b) => compareBigint(a.pool.periodEnd, b.pool.periodEnd) || compareBigint(a.pool.id, b.pool.id));
}

function compareBigint(a: bigint, b: bigint): number {
  return a === b ? 0 : a < b ? -1 : 1;
}

/**
 * The run the hero features: the open commitment run with the most players;
 * a tie goes to a sleep run (the product lives at night), then to the one
 * ending soonest. Only commitment runs qualify, because the hero states their
 * payout math. A run whose count did not read counts as zero players.
 */
export function pickFeaturedRun(runs: readonly OpenRun[]): OpenRun | null {
  const candidates = runs.filter((r) => r.pool.bountyModel === COMMITMENT_MODEL);
  if (candidates.length === 0) return null;
  return [...candidates].sort((a, b) => {
    const byPlayers = (b.players ?? 0) - (a.players ?? 0);
    if (byPlayers !== 0) return byPlayers;
    const aSleep = runKind(a.pool.goalSpec) === "sleep" ? 0 : 1;
    const bSleep = runKind(b.pool.goalSpec) === "sleep" ? 0 : 1;
    if (aSleep !== bSleep) return aSleep - bSleep;
    return compareBigint(a.pool.periodEnd, b.pool.periodEnd) || compareBigint(a.pool.id, b.pool.id);
  })[0];
}

// ------------------------------------------------------------------ words

/** A sentence with some parts set strong (the figures), for <b> rendering. */
export type Segment = { text: string; strong?: boolean };

export function segmentsText(segments: readonly Segment[]): string {
  return segments.map((s) => s.text).join("");
}

/** The stake as a button says it: "1" for 1.00, "0.50" otherwise. */
export function stakeWords(entryFee: bigint): string {
  const usd = formatUsdc(entryFee);
  return usd.endsWith(".00") ? usd.slice(0, -3) : usd;
}

/** A live run's terms, as the hero and the outcome tabs read them. */
export interface RunTerms {
  entryFee: bigint;
  /** Players in now, not counting the visitor. */
  players: number;
  /** pool.balance: every stake plus any sponsor money. */
  balance: bigint;
  /** commitmentFeeBps; null when it could not be read. */
  feeBps: number | null;
}

export function termsOf(run: OpenRun, feeBps: number | null): RunTerms | null {
  if (run.players === null) return null;
  return { entryFee: run.pool.entryFee, players: run.players, balance: run.pool.balance, feeBps };
}

function playersIn(n: number): string {
  return n === 1 ? "1 player in" : `${n} players in`;
}

/**
 * The line under the hero's stats. With no fee read, no figure past the stake
 * is stated: a number we cannot stand behind is not shown.
 */
export function heroNote(terms: RunTerms): Segment[] {
  const stake = formatUsdc(terms.entryFee);
  const pot = sponsorPotOf(terms);
  if (terms.feeBps === null) {
    return [
      { text: `Everyone stakes ${stake}. Hit it and your stake comes back plus a share of the missed stakes.` },
    ];
  }
  const range = commitmentRange({
    entryFee: terms.entryFee,
    players: terms.players,
    sponsorPot: pot,
    feeBps: terms.feeBps,
    includeJoiner: true,
  });
  if (terms.players === 0) {
    if (pot === 0n) {
      return [
        { text: "Nobody's in yet. Hit it and your " },
        { text: stake, strong: true },
        { text: " comes back, plus a share of the stakes that miss." },
      ];
    }
    return [
      { text: "Nobody's in yet. Hit it alone and " },
      { text: formatUsdc(range.ifOnlyYou), strong: true },
      { text: ` comes back: your ${stake} plus the ${formatUsdc(pot)} pot.` },
    ];
  }
  const share = pot > 0n ? `an equal share of the ${formatUsdc(pot)} pot and any missed stakes` : "an equal share of any missed stakes";
  return [
    { text: `${playersIn(terms.players)}. Hit it and you get ` },
    { text: formatUsdc(range.ifEveryone), strong: true },
    { text: " to " },
    { text: formatUsdc(range.ifOnlyYou), strong: true },
    { text: ` back: your ${stake}, plus ${share}.` },
  ];
}

/** "Nobody in yet", "1 player in", "3 players in"; null when not read. */
export function playersWords(players: number | null): string | null {
  if (players === null) return null;
  return players === 0 ? "Nobody in yet" : playersIn(players);
}

// ------------------------------------------------------------ outcomes

export type OutcomeKey = "hit" | "miss" | "none";

export interface OutcomeCopy {
  heading: string;
  body: string;
  /** The worked figure for THIS run, or null when no live run was read. */
  worked: { label: string; usd: string; tone: "money" | "dusk" | "plain" } | null;
}

/**
 * The three ways a run ends, worded once. A miss is only a miss when the
 * wearable shows it: a run with no data from your wearable refunds the stake.
 */
export function outcomeCopy(key: OutcomeKey, terms: RunTerms | null): OutcomeCopy {
  const stake = terms !== null ? formatUsdc(terms.entryFee) : null;
  const pot = terms !== null ? sponsorPotOf(terms) : 0n;
  switch (key) {
    case "hit": {
      let worked: OutcomeCopy["worked"] = null;
      if (terms !== null && terms.feeBps !== null) {
        const o = commitmentOutcome({
          entryFee: terms.entryFee,
          players: terms.players + 1,
          achievers: 1,
          sponsorPot: pot,
          feeBps: terms.feeBps,
        });
        worked = {
          label: "In this run, if you hit alone",
          usd: formatUsdc(o.kind === "paid" ? o.perAchiever : o.refundEach),
          tone: "money",
        };
      }
      return {
        heading: "Your stake comes back, plus a share.",
        body:
          pot > 0n
            ? "An equal share of the missed stakes and the sponsor pot goes to everyone who hits."
            : "An equal share of the missed stakes goes to everyone who hits.",
        worked,
      };
    }
    case "miss":
      return {
        heading: "Your stake goes to the players who hit.",
        body: `${stake !== null ? `Your ${stake}` : "Your stake"} is shared equally among everyone whose wearable shows they hit. If your wearable sends nothing for the run, that is not a miss, and your stake comes back.`,
        worked: terms !== null ? { label: "You get back", usd: formatUsdc(0n), tone: "dusk" } : null,
      };
    case "none": {
      let worked: OutcomeCopy["worked"] = null;
      if (terms !== null) {
        const o = commitmentOutcome({
          entryFee: terms.entryFee,
          players: terms.players + 1,
          achievers: 0,
          sponsorPot: pot,
        });
        worked = {
          label: "Your stake back",
          usd: formatUsdc(o.kind === "refund-all" ? o.refundEach : o.stakeBack),
          tone: "plain",
        };
      }
      return {
        heading: "Everyone gets their stake back.",
        body: "If nobody's wearable shows a hit, every stake is refunded in full.",
        worked,
      };
    }
  }
}

// ------------------------------------------------------------ time

/** "Sun 08:30" in the viewer's own time zone. Client-only: it reads the clock. */
export function endsAtWords(periodEnd: bigint, timeZone?: string): string {
  const fmt = new Intl.DateTimeFormat("en-US", {
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  });
  return fmt.format(new Date(Number(periodEnd) * 1000)).replace(",", "");
}

/** The hero tag: a sleep run that ends within a day and a half is tonight's. */
export function openTag(goalSpec: string, periodEnd: bigint, nowSeconds: number): string {
  const hoursLeft = (Number(periodEnd) - nowSeconds) / 3600;
  return runKind(goalSpec) === "sleep" && hoursLeft <= 36 ? "Open tonight" : "Open now";
}
