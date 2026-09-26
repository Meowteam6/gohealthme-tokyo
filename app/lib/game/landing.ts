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
import { friendMathOf } from "@/lib/game/run-page";
import { missRuleFromPoolId, missRulePool } from "@/lib/miss-rule";
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
  return withPercent(name, pool.goalSpec);
}

/**
 * An efficiency run's title was written with a bare number ("Sleep efficiency
 * 85 tonight"), while its goal and run page say 85%. Put the sign back, only
 * when the goal really is an efficiency goal at that same number.
 */
function withPercent(name: string, goalSpec: string): string {
  const spec = classifyWearableGoal(goalSpec);
  if (spec.metric !== "sleep_efficiency") return name;
  return name.replace(/\befficiency\s+(\d+(?:\.\d+)?)\b(?!\s*%)/i, (whole, n: string) =>
    Number(n) === spec.threshold ? `${whole}%` : whole,
  );
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
  /** Whether SPOTTER can record a miss on this run (lib/miss-rule.ts). When
   *  it cannot, a miss is refunded at settle and no missed stake is shared. */
  recordsMisses: boolean;
}

export function termsOf(
  run: OpenRun,
  feeBps: number | null,
  fromPoolId: bigint | null = missRuleFromPoolId(),
): RunTerms | null {
  if (run.players === null) return null;
  return {
    entryFee: run.pool.entryFee,
    players: run.players,
    balance: run.pool.balance,
    feeBps,
    recordsMisses: missRulePool(run.pool, fromPoolId).ok,
  };
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
      {
        text: terms.recordsMisses
          ? `Everyone stakes ${stake}. Hit it and your stake comes back plus a share of the missed stakes.`
          : `Everyone stakes ${stake}. Hit it or miss it, your stake comes back; a hit adds a share of any sponsor pot.`,
      },
    ];
  }
  const range = commitmentRange({
    entryFee: terms.entryFee,
    players: terms.players,
    sponsorPot: pot,
    feeBps: terms.feeBps,
    includeJoiner: true,
    recordsMisses: terms.recordsMisses,
  });
  if (terms.players === 0) {
    if (pot === 0n) {
      return terms.recordsMisses
        ? [
            { text: "Nobody's in yet. Hit it and your " },
            { text: stake, strong: true },
            { text: " comes back, plus a share of the stakes that miss." },
          ]
        : [
            { text: "Nobody's in yet. Hit it or miss it, your " },
            { text: stake, strong: true },
            { text: " comes back: this run cannot record a miss." },
          ];
    }
    return [
      { text: "Nobody's in yet. Hit it alone and " },
      { text: formatUsdc(range.ifOnlyYou), strong: true },
      { text: ` comes back: your ${stake} plus the ${formatUsdc(pot)} pot.` },
    ];
  }
  if (!terms.recordsMisses) {
    // A miss here is refunded before the split, so only the sponsor pot is
    // shared: with no pot, a hit is the stake back however many hit.
    if (range.ifEveryone === range.ifOnlyYou) {
      return [
        { text: `${playersIn(terms.players)}. Hit it and your ` },
        { text: formatUsdc(range.ifOnlyYou), strong: true },
        { text: " comes back. This run cannot record a miss, so a miss comes back too." },
      ];
    }
    return [
      { text: `${playersIn(terms.players)}. Hit it and you get ` },
      { text: formatUsdc(range.ifEveryone), strong: true },
      { text: " to " },
      { text: formatUsdc(range.ifOnlyYou), strong: true },
      { text: ` back: your ${stake}, plus an equal share of the ${formatUsdc(pot)} sponsor pot. A miss here is refunded.` },
    ];
  }
  // "Sponsor pot", never bare "pot": once anyone is in, the Pot stat above is
  // the whole balance (stakes included), and this figure is only the sponsor's.
  const share = pot > 0n ? `an equal share of the ${formatUsdc(pot)} sponsor pot and any missed stakes` : "an equal share of any missed stakes";
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

/**
 * The challenge band's worked example: two friends at the same stake. Both
 * hit and both stakes come back; only one hits and that one takes both, but
 * only on a challenge that can record the miss (lib/miss-rule.ts). With the
 * miss rule off on this build (`missRule` false), no challenge records a
 * miss, so the band promises nothing past both stakes coming back. The
 * figures are commitmentOutcome's, for a challenge with no sponsor pot.
 */
export function challengeNote(entryFee: bigint, missRule: boolean): Segment[] {
  const both = commitmentOutcome({ entryFee, players: 2, achievers: 2, sponsorPot: 0n });
  const one = commitmentOutcome({ entryFee, players: 2, achievers: 1, sponsorPot: 0n });
  const amount = (o: typeof one) => formatUsdc(o.kind === "paid" ? o.perAchiever : o.refundEach);
  const lead: Segment[] = [
    { text: `Stake ${formatUsdc(entryFee)} each. If you both hit, you both get ` },
    { text: amount(both), strong: true },
    { text: " back." },
  ];
  if (!missRule) return lead;
  return [
    ...lead,
    { text: " On a challenge that can record a miss, if only one of you hits, that one gets " },
    { text: amount(one), strong: true },
    { text: "." },
  ];
}

/**
 * The challenge band's line, worked from the featured run the band links to:
 * the same stake for both of you, and what each of you gets if you both hit.
 * A figure only while it is exact (friendMathOf: nobody else in yet); with
 * others in, their nights change the split, so it says what a hit is made of.
 * Their miss only reaches you on a run that can record one.
 */
export function friendNote(terms: RunTerms): Segment[] {
  const stake = formatUsdc(terms.entryFee);
  const lead: Segment = { text: `Stake ${stake} each. ` };
  const math = friendMathOf(terms, false);
  if (math !== null) {
    const both: Segment[] = [
      lead,
      { text: "If you both hit, each of you gets " },
      { text: math.bothHit, strong: true },
      { text: " back." },
    ];
    if (!terms.recordsMisses) return both;
    return [...both, { text: " If they miss, you get " }, { text: math.friendMisses, strong: true }, { text: "." }];
  }
  const pot = sponsorPotOf(terms);
  if (pot > 0n) {
    return [
      lead,
      { text: `If you both hit, each of you gets your ${stake} back plus an equal share of the ` },
      { text: formatUsdc(pot), strong: true },
      { text: terms.recordsMisses ? " sponsor pot and any missed stakes." : " sponsor pot." },
    ];
  }
  return [
    lead,
    {
      text: terms.recordsMisses
        ? "If you both hit, each of you gets your stake back plus an equal share of any missed stakes."
        : "If you both hit, you both get your stake back.",
    },
  ];
}

/** The band's question, for the kind of run it links to. */
export function friendQuestion(kind: RunKind | null): string {
  switch (kind) {
    case "workout":
      return "Know someone who swears they work out every day?";
    case "move":
      return "Know someone who swears they hit their steps?";
    default:
      return "Know someone who swears they sleep 8 hours?";
  }
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
 * And a miss only goes to the players who hit on a run that can record one
 * (lib/miss-rule.ts): the featured run's terms say whether it can, and with
 * no live run `missRule` says whether any run on this build can.
 */
export function outcomeCopy(
  key: OutcomeKey,
  terms: RunTerms | null,
  missRule: boolean = missRuleFromPoolId() !== null,
): OutcomeCopy {
  const stake = terms !== null ? formatUsdc(terms.entryFee) : null;
  const pot = terms !== null ? sponsorPotOf(terms) : 0n;
  const recordsMisses = terms !== null ? terms.recordsMisses : missRule;
  switch (key) {
    case "hit": {
      let worked: OutcomeCopy["worked"] = null;
      if (terms !== null && terms.feeBps !== null) {
        // On a run that cannot record a miss, everyone else's miss is refunded
        // before the split, so hitting alone is your stake plus the pot.
        const o = commitmentOutcome({
          entryFee: terms.entryFee,
          players: terms.recordsMisses ? terms.players + 1 : 1,
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
      if (!recordsMisses) {
        return {
          heading: pot > 0n ? "Your stake comes back, plus a share." : "Your stake comes back.",
          body:
            pot > 0n
              ? "An equal share of the sponsor pot goes to everyone who hits. This run cannot record a miss, so no missed stake is shared."
              : terms !== null
                ? "This run cannot record a miss, so there are no missed stakes to share. A sponsor pot, when a run has one, is shared equally among everyone who hits."
                : "No run on this build records a miss yet, so a hit is your stake back plus an equal share of any sponsor pot.",
          worked,
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
      if (terms !== null && !terms.recordsMisses) {
        return {
          heading: "On this run, your stake comes back.",
          body: "This run cannot record a miss, so a miss is refunded when it settles. On a run that can, the run page says so before you stake, and a miss your wearable shows goes to the players who hit.",
          worked: { label: "You get back", usd: formatUsdc(terms.entryFee), tone: "plain" },
        };
      }
      if (terms === null && !missRule) {
        return {
          heading: "Your stake comes back.",
          body: "No run on this build records a miss yet, so a miss is refunded when the run settles.",
          worked: null,
        };
      }
      return {
        heading: "Your stake goes to the players who hit.",
        body:
          terms !== null
            ? `Your ${stake} is shared equally among everyone whose wearable shows they hit. If your wearable sends nothing for the run, that is not a miss, and your stake comes back.`
            : "It is shared equally among everyone whose wearable shows they hit, on a run that can record a miss; the run page says so before you stake, and every other run refunds a miss. If your wearable sends nothing for the run, that is not a miss, and your stake comes back.",
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
