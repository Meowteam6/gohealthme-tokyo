// The money flows (docs/MONEY-FLOWS.md): which flow a run is, the two chips
// every money surface shows, and each flow's terms, worded as section 3 words
// them. Pure, so every sentence is pinned by a test with exact numbers.
//
//   F1 Group run            model 2, public, everyone stakes the same
//   F2 Stake on yourself    a challenge the creator staked in; friends match it
//   F3 Challenge a friend   a challenge with a reward; the friend stakes a lock-in
//   F4 Sponsored run        model 0 or 1, a sponsor puts up the pot
//   F5 Chip in              adding to someone else's pot (the backer page)
//
// Every figure comes from lib/commitment.ts (commitmentOutcome and
// commitmentRange mirror HealthPoolsV3). Nothing here does its own payout math.
//
// The miss chip is the one fact a player must see before a stake: on a run
// the miss rule covers (lib/miss-rule.ts) a miss goes to the players who hit,
// at any count, since anyone can join after you; the terms say the solo case.
// Everything else gives the stake back. That rule lives in
// lib/commitment-copy.ts (missConsequence), the one place every surface reads
// it from. Voice: stake, challenge, pot; never bet, wager or odds.

import { commitmentOutcome, commitmentRange } from "@/lib/commitment";
import { missConsequence, type MissChip } from "@/lib/commitment-copy";
import { formatUsdc } from "@/lib/contract";
import { challengeRunKindOf, type ChallengeRunKind } from "@/lib/game/money-sharing";

export type FlowId = "F1" | "F2" | "F3" | "F4" | "F5";

export interface FlowKind {
  flow: FlowId;
  /** The flow's name in the UI. */
  name: string;
  /** The kind chip. */
  chip: string;
}

export interface FlowContext {
  /** Stakers in the run now (participantCount); null while unread. */
  players: number | null;
  /** Whether the creator staked in their own run. Null when unread. */
  creatorStaked: boolean | null;
  /** The creator's seed at create (R), or the pot net of every stake where
   *  the seed cannot be split from backers' money; null or absent while
   *  unread. Money decides first (challengeRunKindOf): a seed above zero is
   *  a challenge with a reward (F3) even when the challenger also joined;
   *  otherwise it is a stake on yourself (F2), locked in or not yet. */
  seed?: bigint | null;
  /** The flow a surface already decided from the same rule (the link page
   *  decides once for its headline, the create form by the creator's own
   *  choice). Derived from creatorStaked and seed when absent. */
  kind?: ChallengeRunKind;
  /** "@handle" or a short address. */
  creatorName: string;
  /** The person reading is the run's creator. */
  viewerIsCreator?: boolean;
  /** The backer page (/c/[token]?as=backer). */
  backer?: boolean;
}

const COMMITMENT_MODEL = 2;
const CHALLENGE_INITIATIVE = "challenge";

/** Which flow a run is, with its UI name and kind chip. */
export function flowKindOf(
  pool: { bountyModel: number; initiative: string },
  ctx: FlowContext,
): FlowKind {
  if (ctx.backer === true) return { flow: "F5", name: "Chip in", chip: "Backing" };
  const creator = ctx.viewerIsCreator === true ? "you" : ctx.creatorName;
  if (pool.bountyModel !== COMMITMENT_MODEL) {
    return { flow: "F4", name: "Sponsored run", chip: `Sponsored by ${creator}` };
  }
  if (pool.initiative !== CHALLENGE_INITIATIVE) {
    return { flow: "F1", name: "Group run", chip: "Group run" };
  }
  const kind =
    ctx.kind ??
    challengeRunKindOf({ creatorStaked: ctx.creatorStaked === true, reward: ctx.seed ?? null });
  if (kind === "reward") {
    return { flow: "F3", name: "Challenge a friend", chip: `Challenge from ${creator}` };
  }
  // A stake on yourself, locked in or about to be: the creator is the first
  // staker, friends match.
  const others = Math.max(0, (ctx.players ?? 0) - 1);
  if (ctx.viewerIsCreator === true) {
    return { flow: "F2", name: "Stake on yourself", chip: others === 0 ? "On yourself" : `You + ${others}` };
  }
  return {
    flow: "F2",
    name: "Stake on yourself",
    chip: others === 0 ? `Match ${ctx.creatorName}` : `${ctx.creatorName} + ${others}`,
  };
}

/** Stakers once the reader is in: the count now, plus them when about to join.
 *  The miss term counts these for its solo case. */
export function stakersAfter(players: number, includeJoiner: boolean): number {
  return players + (includeJoiner ? 1 : 0);
}

// ------------------------------------------------------------------ terms

export type MoneyTermKey = "stake" | "hit" | "miss" | "nobody" | "confirm" | "match" | "accepted";

export interface MoneyTerm {
  key: MoneyTermKey;
  text: string;
}

export interface MoneyCopy {
  flow: FlowId;
  /** The line on the card. */
  line: string;
  terms: MoneyTerm[];
}

export interface MoneyInput {
  /** S: the stake, or the lock-in L on a challenge with a reward. */
  entryFee: bigint;
  /** Stakers in the run now, not counting the reader. */
  players: number;
  /** R + B: everything in the pot beyond the stakes (sponsorPotOf). */
  pot: bigint;
  /** commitmentFeeBps; null when it did not read (no range is promised). */
  feeBps: number | null;
  /** missRulePool(pool).ok, or missRuleWouldApply on a create form. */
  recordable: boolean;
  /** The reader is about to stake: count them in the range and the chip. */
  includeJoiner: boolean;
  /** When a hit must be confirmed by, already formatted; null says "before
   *  the run settles" (a run that cannot record a miss has no fixed time). */
  confirmBy: string | null;
}

const usd = (v: bigint): string => formatUsdc(v);
const plural = (n: number, one: string, many: string): string => (n === 1 ? one : many);

/** Term 2 for a run where hitters share: the live range, or no number
 *  when the fee did not read. */
function sharedHitTerm(input: MoneyInput, stake: string): string {
  if (input.feeBps === null) {
    if (input.recordable) return `Hit: ${stake} back + a share.`;
    return input.pot > 0n ? `Hit: ${stake} back + a share of the pot.` : `Hit: your ${stake} comes back.`;
  }
  const range = commitmentRange({
    entryFee: input.entryFee,
    players: input.players,
    sponsorPot: input.pot,
    feeBps: input.feeBps,
    includeJoiner: input.includeJoiner,
    recordsMisses: input.recordable,
  });
  if (range.ifEveryone === range.ifOnlyYou) {
    return range.ifOnlyYou === input.entryFee
      ? `Hit: your ${stake} comes back.`
      : `Hit: ${stake} back + a share, ${usd(range.ifOnlyYou)} right now.`;
  }
  return `Hit: ${stake} back + a share, ${usd(range.ifEveryone)} to ${usd(range.ifOnlyYou)} right now.`;
}

function confirmTerm(input: MoneyInput, stake: string): MoneyTerm {
  const by = input.confirmBy !== null ? `by ${input.confirmBy}` : "before the run settles";
  return { key: "confirm", text: `Confirm your hit ${by}, or you only get ${stake} back. Test money, beta.` };
}

/** F1 Group run, and F2 once friends have matched: everyone stakes the same. */
export function groupRunCopy(input: MoneyInput): MoneyCopy {
  const stake = usd(input.entryFee);
  const pot = input.pot > 0n ? usd(input.pot) : null;
  const line = input.recordable
    ? `Everyone stakes ${stake} USDC. Hit it and you split the stakes of whoever misses${pot !== null ? `, plus the ${pot} sponsor pot` : ""}.`
    : `Everyone stakes ${stake} USDC. Hit it and your ${stake} comes back${pot !== null ? `, plus a share of the ${pot} sponsor pot` : ""}.`;
  return {
    flow: "F1",
    line,
    terms: [
      {
        key: "stake",
        text:
          input.players === 0
            ? `Same stake: ${stake}, nobody in yet.`
            : `Same stake: ${stake}, ${input.players} in so far.`,
      },
      { key: "hit", text: sharedHitTerm(input, stake) },
      {
        key: "miss",
        text: !input.recordable
          ? `Miss: your ${stake} comes back. This run cannot record a miss.`
          : stakersAfter(input.players, input.includeJoiner) < 2
            ? // Alone, a miss comes back. The chip already warns that anyone
              // can join and change that; the term says both before the
              // stake, with the case that undoes it (nobody hitting refunds
              // every recorded stake, HealthPoolsV3 H = 0).
              `Miss: your ${stake} comes back while you are the only one in; once others stake, a miss your wearable shows goes to whoever hits, or comes back if nobody does.`
            : `Miss: if your wearable shows it and anyone hits, your ${stake} goes to them; if nobody hits, it comes back. No data from your wearable is not a miss.`,
      },
      confirmTerm(input, stake),
    ],
  };
}

/**
 * F2 Stake on yourself. One staker (the creator, or the creator about to lock
 * in): a miss comes back, because nobody else can hit. Matched (two or more
 * once the reader is in): the group run's terms, with the names line.
 */
export function selfStakeCopy(
  input: MoneyInput & { creatorName: string; viewerIsCreator: boolean },
): MoneyCopy {
  const stake = usd(input.entryFee);
  const stakers = stakersAfter(input.players, input.includeJoiner);
  if (stakers <= 1) {
    return {
      flow: "F2",
      line: `Your ${stake} USDC on your own goal. Get friends to match it.`,
      terms: [
        { key: "stake", text: "You are the only one staked." },
        {
          key: "hit",
          text:
            input.pot > 0n
              ? `Hit: ${stake} back + ${usd(input.pot)} from backers.`
              : `Hit: ${stake} back, plus anything backers chip in.`,
        },
        { key: "miss", text: `Miss: ${stake} comes back.` },
        {
          key: "match",
          text: input.recordable
            ? "Once a friend matches you, whoever misses pays whoever hits."
            : "Friends can match your stake. This run cannot record a miss, so a miss comes back either way.",
        },
      ],
    };
  }
  const friends = stakers - 1;
  const who = input.viewerIsCreator ? "You" : input.creatorName;
  const group = groupRunCopy(input);
  return {
    flow: "F2",
    line: `${who} + ${friends} ${plural(friends, "friend", "friends")}, ${stake} USDC each.`,
    terms: group.terms,
  };
}

/**
 * F3 Challenge a friend. The challenger puts up the reward R and does not
 * stake; whoever accepts stakes the lock-in L. With one accepter a miss has
 * nobody to go to, so L comes back; anyone holding the link can accept, and
 * with two or more, on a run that can record a miss, whoever misses pays
 * whoever hits.
 */
export function challengeCopy(
  input: MoneyInput & {
    /** "@handle", or "You" when the challenger is reading. */
    challengerName: string;
    challengerIsYou: boolean;
    /** "@handle", "You" when the challenged player is reading, or null when
     *  the challenge went out as a bare link. */
    targetName: string | null;
    targetIsYou: boolean;
    /** R alone when it can be told from backers' money; null says the pot. */
    reward: bigint | null;
    /** The run's end, formatted: the challenger takes R + B back after it. */
    endsOn: string;
  },
): MoneyCopy {
  const lockIn = usd(input.entryFee);
  const accepters = stakersAfter(input.players, input.includeJoiner);
  const challenger = input.challengerIsYou ? "You" : input.challengerName;
  const challengerMid = input.challengerIsYou ? "you" : input.challengerName;
  const takes = input.challengerIsYou ? "take" : "takes";
  const target = input.targetIsYou ? "You" : (input.targetName ?? "Whoever accepts");
  const stakes = input.targetIsYou ? "stake" : "stakes";

  const opening =
    input.reward !== null
      ? `${challenger} put up ${usd(input.reward)} USDC.`
      : `The pot holds ${usd(input.pot)} USDC.`;
  let getLine: string;
  if (accepters <= 1) {
    // One accepter who hits takes the whole pot: L + R + B.
    const alone = commitmentOutcome({
      entryFee: input.entryFee,
      players: 1,
      achievers: 1,
      sponsorPot: input.pot,
      feeBps: input.feeBps ?? 0,
    });
    const total = alone.kind === "paid" ? alone.perAchiever : alone.refundEach;
    getLine = `hit it and get ${usd(total)}.`;
  } else if (input.feeBps !== null) {
    const range = commitmentRange({
      entryFee: input.entryFee,
      players: input.players,
      sponsorPot: input.pot,
      feeBps: input.feeBps,
      includeJoiner: input.includeJoiner,
      recordsMisses: input.recordable,
    });
    getLine = `hit it and get up to ${usd(range.ifOnlyYou)}.`;
  } else {
    getLine = "hit it and get a share of the pot.";
  }

  const hit =
    accepters <= 1
      ? input.pot > 0n
        ? `Hit: ${lockIn} back + ${usd(input.pot)}.`
        : `Hit: your ${lockIn} comes back.`
      : sharedHitTerm(input, lockIn);
  // What happens to the pot after this player's miss. Alone, a miss means
  // nobody hit, so the challenger takes it back. With others in, another
  // accepter can still hit and take it, so the take-back hangs on nobody
  // hitting: on a run that records misses that clause is already there; on
  // one that cannot, it is said as its own sentence.
  const takeBack = input.pot > 0n ? `${challengerMid} ${takes} back ${usd(input.pot)} after ${input.endsOn}` : "";
  const andTakeBack = takeBack !== "" ? `, and ${takeBack}` : "";
  const miss =
    accepters >= 2 && input.recordable
      ? `Miss: if your wearable shows it and another player hits, your ${lockIn} goes to them; if nobody hits, it comes back${andTakeBack}.`
      : accepters >= 2 && takeBack !== ""
        ? `Miss: ${lockIn} comes back. If nobody hits, ${takeBack}.`
        : `Miss: ${lockIn} comes back${andTakeBack}.`;
  const rule = input.recordable
    ? "if more than one, whoever misses pays whoever hits."
    : "this run cannot record a miss, so a miss comes back however many accept.";
  const accepted =
    input.players === 0
      ? `Nobody has accepted this link yet; ${rule}`
      : `${input.players} ${plural(input.players, "person has", "people have")} accepted this link; ${rule}`;

  return {
    flow: "F3",
    line: `${opening} ${target} ${stakes} ${lockIn}: ${getLine}`,
    terms: [
      { key: "stake", text: `Accepting stakes ${lockIn}.` },
      { key: "hit", text: hit },
      { key: "miss", text: miss },
      { key: "accepted", text: accepted },
    ],
  };
}

/**
 * F4 Sponsored run (models 0 and 1). A miss is never recorded on these, so it
 * comes back; a hit can pay less than the stake when the pot is short.
 */
export function sponsoredCopy(input: {
  bountyModel: number;
  entryFee: bigint;
  /** R + B: the balance net of every stake, which is the sponsor's money
   *  plus anything backers added. The whole of it goes back to the sponsor
   *  when nobody hits. */
  pot: bigint;
  /** R alone, where it is known: the deposit typed on the create form. Null
   *  on a live run, where the chain cannot tell R from B, so the line names
   *  the pot instead of crediting the sponsor with backers' money. */
  reward: bigint | null;
  /** "@handle", a short address, or "You". */
  sponsorName: string;
  sponsorIsYou: boolean;
}): MoneyCopy {
  const stake = usd(input.entryFee);
  const sponsor = input.sponsorIsYou ? "You" : input.sponsorName;
  const sponsorMid = input.sponsorIsYou ? "you" : input.sponsorName;
  const opening =
    input.reward !== null
      ? `${sponsor} put up ${usd(input.reward)} USDC.`
      : `The pot holds ${usd(input.pot)} USDC.`;
  return {
    flow: "F4",
    line: `${opening} Stake ${stake} to enter.`,
    terms: [
      {
        key: "hit",
        text:
          input.bountyModel === 0
            ? `Hit: pays ${stake} × your multiplier, scaled down if the pot is short, so it can be under ${stake}.`
            : `Hit: pays a weighted share, which can be under ${stake}.`,
      },
      { key: "miss", text: `Miss: ${stake} comes back.` },
      { key: "nobody", text: `Nobody hits: ${usd(input.pot)} goes back to ${sponsorMid}.` },
    ],
  };
}

export interface RunMoney {
  kind: FlowKind;
  miss: MissChip;
  /** The flow's line and terms; null on the backer page, whose chip-in card
   *  carries its own words. */
  copy: MoneyCopy | null;
}

/**
 * One call for a money surface: the flow, both chips and the terms. The
 * surface brings what it read; this picks the builder.
 */
export function runMoneyOf(input: {
  pool: { bountyModel: number; initiative: string };
  flow: FlowContext;
  numbers: MoneyInput;
  /** F3 only: the challenged player, and whether they are reading. */
  targetName?: string | null;
  targetIsYou?: boolean;
  /** F3 and F4: the creator's own money R, where it can be told from
   *  backers' money (the create form, the link page's funding read). Absent
   *  on a live run page, whose line then names the pot. */
  reward?: bigint | null;
  /** F3 only: the run's end, formatted. */
  endsOn?: string;
}): RunMoney {
  const kind = flowKindOf(input.pool, input.flow);
  const n = input.numbers;
  const miss = missConsequence({ recordable: n.recordable });
  const you = input.flow.viewerIsCreator === true;
  let copy: MoneyCopy | null;
  switch (kind.flow) {
    case "F1":
      copy = groupRunCopy(n);
      break;
    case "F2":
      copy = selfStakeCopy({ ...n, creatorName: input.flow.creatorName, viewerIsCreator: you });
      break;
    case "F3":
      copy = challengeCopy({
        ...n,
        challengerName: input.flow.creatorName,
        challengerIsYou: you,
        targetName: input.targetName ?? null,
        targetIsYou: input.targetIsYou === true,
        reward: input.reward ?? null,
        endsOn: input.endsOn ?? "the run ends",
      });
      break;
    case "F4":
      copy = sponsoredCopy({
        bountyModel: input.pool.bountyModel,
        entryFee: n.entryFee,
        pot: n.pot,
        reward: input.reward ?? null,
        sponsorName: input.flow.creatorName,
        sponsorIsYou: you,
      });
      break;
    case "F5":
      copy = null;
      break;
  }
  return { kind, miss, copy };
}

/** The flow's miss term as a sentence, for under the stake button beside the
 *  miss chip: "If anyone hits, your 1.00 goes to them; ...". */
export function missDetailOf(copy: MoneyCopy): string | null {
  const term = copy.terms.find((t) => t.key === "miss");
  if (term === undefined) return null;
  const rest = term.text.replace(/^Miss: /, "");
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

/** A moment for a sentence, "Sep 27, 14:30", in the reader's zone. */
export function momentLabel(ms: number, timeZone?: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone,
  }).format(new Date(ms));
}
