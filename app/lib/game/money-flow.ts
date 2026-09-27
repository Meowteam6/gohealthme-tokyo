// The money flows (docs/MONEY-FLOWS.md): which flow a run is, the two chips
// every money surface shows, and each flow's terms, worded as section 3 words
// them. Pure, so every sentence is pinned by a test with exact numbers.
//
//   F1 Group challenge      model 2, public, everyone stakes the same
//   F2 Match the stake      the one challenge flow: the creator stakes S,
//                           friends match S, anyone adds extra to the pot
//   F4 Sponsored challenge  model 0 or 1, a sponsor puts up the money
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

export type FlowId = "F1" | "F2" | "F4" | "F5";

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
  /** The flow a surface already decided from the same rule (the link page
   *  decides once for its headline). Derived from creatorStaked when absent. */
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
    return { flow: "F4", name: "Sponsored challenge", chip: `Sponsored by ${creator}` };
  }
  if (pool.initiative !== CHALLENGE_INITIATIVE) {
    return { flow: "F1", name: "Group challenge", chip: "Group challenge" };
  }
  // The creator's own stake on their own goal, locked in or about to be:
  // friends match it.
  const others = Math.max(0, (ctx.players ?? 0) - 1);
  if (ctx.viewerIsCreator === true) {
    return { flow: "F2", name: "Match the stake", chip: others === 0 ? "On yourself" : `You + ${others}` };
  }
  return {
    flow: "F2",
    name: "Match the stake",
    chip: others === 0 ? `Match ${ctx.creatorName}` : `${ctx.creatorName} + ${others}`,
  };
}

/** Stakers once the reader is in: the count now, plus them when about to join.
 *  The miss term counts these for its solo case. */
export function stakersAfter(players: number, includeJoiner: boolean): number {
  return players + (includeJoiner ? 1 : 0);
}

// ------------------------------------------------------------------ terms

/** "split" is one hitting while another misses, "both" is everyone hitting:
 *  the two rows of the equal-stakes table (F2). */
export type MoneyTermKey =
  | "stake"
  | "hit"
  | "split"
  | "both"
  | "miss"
  | "nobody"
  | "confirm"
  | "match"
  | "accepted";

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
  /** R + B: everything in the pot beyond the stakes (sponsorPotOf), the
   *  extra a hit shares. */
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

/** Term 2 for a run where hitters share: the live range, or no number
 *  when the fee did not read. */
function sharedHitTerm(input: MoneyInput, stake: string): string {
  if (input.feeBps === null) {
    if (input.recordable) return `Hit: ${stake} back + a share.`;
    return input.pot > 0n ? `Hit: ${stake} back + a share of the extra.` : `Hit: your ${stake} comes back.`;
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
  const by = input.confirmBy !== null ? `by ${input.confirmBy}` : "before the challenge settles";
  return { key: "confirm", text: `Confirm your hit ${by}, or you only get ${stake} back. Test money, beta.` };
}

/** F1 Group challenge: a public commitment pool, everyone stakes the same. */
export function groupRunCopy(input: MoneyInput): MoneyCopy {
  const stake = usd(input.entryFee);
  const pot = input.pot > 0n ? usd(input.pot) : null;
  const line = input.recordable
    ? `Everyone stakes ${stake} USDC. Hit it and you split the stakes of whoever misses${pot !== null ? `, plus ${pot} extra` : ""}.`
    : `Everyone stakes ${stake} USDC. Hit it and your ${stake} comes back${pot !== null ? `, plus a share of the ${pot} extra` : ""}.`;
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
          ? `Miss: your ${stake} comes back. This challenge cannot record a miss.`
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
 * F2 Match the stake: the core game. Everyone stakes the same S on the same
 * goal. One hits and one misses: the hitter gets their S back plus the missed
 * S. Both hit: both get S back. Nobody hits: every stake comes back. Extra in
 * the pot (the creator's own at create, backers' later) is split evenly among
 * whoever hits, and goes to the creator if nobody does (the contract's
 * sweep). A miss counts only on a challenge the miss rule covers, and only
 * when the wearable shows it; otherwise it comes back.
 *
 * Worded as a table for two (the creator and one friend, the challenge as it
 * is sent), as a group once three or more are in, and alone while nobody has
 * matched. Every figure is commitmentOutcome / commitmentRange.
 */
export function selfStakeCopy(
  input: MoneyInput & {
    creatorName: string;
    viewerIsCreator: boolean;
    /** The creator's own stake is in (or about to be, on the create form).
     *  False while a friend reads a challenge the creator has not locked in. */
    creatorIn?: boolean;
  },
): MoneyCopy {
  const stake = usd(input.entryFee);
  const extra = input.pot;
  const extraUsd = usd(extra);
  const stakers = stakersAfter(input.players, input.includeJoiner);
  const creatorIn = input.creatorIn !== false;
  const creator = input.creatorName;
  // Nobody hits: the contract's sweep hands what is left to the creator.
  const extraTo = input.viewerIsCreator ? "you" : creator;
  const nobodyExtra = extra > 0n ? `, and the ${extraUsd} extra goes to ${extraTo}` : "";

  if (stakers <= 1) {
    if (input.viewerIsCreator) {
      return {
        flow: "F2",
        line: `Your ${stake} USDC on your own goal. Get a friend to match it.`,
        terms: [
          { key: "stake", text: "You are the only one staked." },
          {
            key: "hit",
            text: extra > 0n ? `Hit: ${stake} back + ${extraUsd} extra.` : `Hit: ${stake} back, plus anything backers add.`,
          },
          {
            key: "miss",
            text: `Miss: ${stake} comes back while you are the only one in${
              extra > 0n ? `, and the ${extraUsd} extra goes back to you` : ""
            }.`,
          },
          {
            key: "match",
            text: input.recordable
              ? "Once a friend matches you, whoever hits gets their stake back plus the stake of whoever misses."
              : "Friends can match your stake. This challenge cannot record a miss, so a miss comes back either way.",
          },
        ],
      };
    }
    // A friend reading before anyone else is in: the creator has not locked
    // in yet (or the count is behind).
    return {
      flow: "F2",
      line: creatorIn
        ? `Match ${creator}'s ${stake} USDC stake.`
        : `Match ${creator}'s ${stake} USDC stake. ${creator} has not locked in yet.`,
      terms: [
        {
          key: "stake",
          text: input.players === 0 ? `Same stake: ${stake}. Nobody is in yet.` : `Same stake: ${stake}, ${input.players} in so far.`,
        },
        { key: "hit", text: extra > 0n ? `Hit: ${stake} back + ${extraUsd} extra.` : `Hit: your ${stake} comes back.` },
        { key: "miss", text: `Miss: ${stake} comes back while you are the only one in.` },
        {
          key: "match",
          text: !input.recordable
            ? "This challenge cannot record a miss, so a miss comes back either way."
            : creatorIn
              ? "Once a second player is in, whoever hits gets their stake back plus the stake of whoever misses."
              : `Once ${creator} locks in, whoever hits gets their stake back plus the stake of whoever misses.`,
        },
      ],
    };
  }

  const feeBps = input.feeBps;
  // Everyone hits: nothing is forfeited, so no fee; each gets S plus an
  // equal share of the extra.
  const allHit = commitmentOutcome({
    entryFee: input.entryFee,
    players: stakers,
    achievers: stakers,
    sponsorPot: extra,
    feeBps: 0,
  });
  const each = allHit.kind === "paid" ? allHit.perAchiever : input.entryFee;
  const share = each - input.entryFee;
  const everyone = stakers === 2 ? "Both hit" : "Everyone hits";
  const bothText =
    extra === 0n
      ? `${everyone}: you each get your ${stake} back.`
      : feeBps === null
        ? `${everyone}: you each get your ${stake} back + ${stakers === 2 ? "half" : "an equal share of"} the ${extraUsd} extra.`
        : `${everyone}: you each get your ${stake} back + ${usd(share)} of the extra, ${usd(each)} each.`;
  const missText = input.recordable
    ? stakers === 2
      ? "Miss: it counts only when your wearable shows it. No data from your wearable is not a miss, so that stake comes back."
      : `Miss: if your wearable shows it and anyone hits, your ${stake} goes to them; if nobody hits, it comes back. No data from your wearable is not a miss.`
    : `Miss: your ${stake} comes back. This challenge cannot record a miss.`;

  if (stakers === 2) {
    let splitText: string;
    if (input.recordable) {
      const cut = feeBps !== null && feeBps > 0 ? " less GoHealthMe's cut" : "";
      const parts = `their ${stake} back + the other ${stake}${cut}${extra > 0n ? ` + ${extraUsd} extra` : ""}`;
      const oneHit =
        feeBps !== null
          ? commitmentOutcome({ entryFee: input.entryFee, players: 2, achievers: 1, sponsorPot: extra, feeBps })
          : null;
      const total = oneHit !== null && oneHit.kind === "paid" ? `, ${usd(oneHit.perAchiever)} in all` : "";
      splitText = `One hits, one misses: whoever hits gets ${parts}${total}.`;
    } else {
      // The miss is never recorded, so settle refunds it (HealthPoolsV3 B-2)
      // and the hitter alone shares the extra.
      splitText = `One hits, one misses: the miss comes back, since this challenge cannot record one; whoever hits gets their ${stake} back${
        extra > 0n ? ` + ${extraUsd} extra, ${usd(input.entryFee + extra)} in all` : ""
      }.`;
    }
    return {
      flow: "F2",
      line: input.recordable
        ? `You both stake ${stake} USDC. Whoever hits gets their ${stake} back plus the stake of whoever misses. Both hit: you both get ${stake} back. Extra in the pot is split among whoever hits.`
        : `You both stake ${stake} USDC. Hit it and your ${stake} comes back, plus a share of any extra. This challenge cannot record a miss, so a miss comes back too.`,
      terms: [
        { key: "stake", text: `Same stake: ${stake} each.` },
        { key: "split", text: splitText },
        { key: "both", text: bothText },
        { key: "nobody", text: `Nobody hits: both stakes come back${nobodyExtra}.` },
        { key: "miss", text: missText },
        confirmTerm(input, stake),
      ],
    };
  }

  return {
    flow: "F2",
    line: input.recordable
      ? `Everyone stakes ${stake} USDC. Whoever hits gets their ${stake} back plus an equal share of the stakes of whoever misses. Everyone hits: everyone gets ${stake} back. Extra in the pot is split among whoever hits.`
      : `Everyone stakes ${stake} USDC. Hit it and your ${stake} comes back, plus a share of any extra. This challenge cannot record a miss, so a miss comes back too.`,
    terms: [
      { key: "stake", text: `Same stake: ${stake}, ${input.players} in so far.` },
      { key: "hit", text: sharedHitTerm(input, stake) },
      { key: "both", text: bothText },
      { key: "nobody", text: `Nobody hits: every stake comes back${nobodyExtra}.` },
      { key: "miss", text: missText },
      confirmTerm(input, stake),
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
      : `${usd(input.pot)} USDC extra from the sponsor and backers.`;
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
  /** F4: the sponsor's own money R, where it can be told from backers'
   *  money (the create form). Absent on a live run page, whose line then
   *  names the pot. */
  reward?: bigint | null;
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
    case "F2": {
      // Is the creator's own stake in? A surface that decided the flow says
      // so by its kind ("unstaked" is before the creator locks in).
      const kindNow =
        input.flow.kind ??
        challengeRunKindOf({ creatorStaked: input.flow.creatorStaked === true });
      copy = selfStakeCopy({
        ...n,
        creatorName: input.flow.creatorName,
        viewerIsCreator: you,
        creatorIn: kindNow !== "unstaked",
      });
      break;
    }
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

// ------------------------------------------------------------------ the pot

/**
 * The Pot, one number, with its parts in words: every stake plus the extra
 * ("Pot 22.00: 10.00 each from you and @nikki, plus 2.00 extra from you.").
 * The Pot is all the money in the challenge (pool.balance while live), so a
 * part is never called "the pot". `stakers` is the stakers' names when they
 * are known (one or two), or a count.
 */
export function potLineOf(input: {
  stake: bigint;
  stakers: readonly string[] | number;
  extra: bigint;
  /** Who put the extra in, when one person did. */
  extraFrom?: string | null;
  /** When the figure holds, after the number: "once you match". */
  when?: string;
}): string {
  const names = typeof input.stakers === "number" ? null : input.stakers;
  const count = names !== null ? names.length : (input.stakers as number);
  const pot = input.stake * BigInt(count) + input.extra;
  const stake = usd(input.stake);
  let parts: string;
  if (count === 0) parts = "nobody has staked yet";
  else if (names !== null && count === 1) parts = `${stake} from ${names[0]}`;
  else if (names !== null && count === 2) parts = `${stake} each from ${names[0]} and ${names[1]}`;
  else if (count === 1) parts = `${stake} from 1 player`;
  else parts = `${stake} each from ${count} players`;
  const from = input.extraFrom ?? null;
  const extra = input.extra > 0n ? `, plus ${usd(input.extra)} extra${from !== null ? ` from ${from}` : ""}` : "";
  return `Pot ${usd(pot)}${input.when !== undefined ? ` ${input.when}` : ""}: ${parts}${extra}.`;
}

/**
 * What the friend will see, from the create form: the challenge as it reads
 * once the creator has locked in their stake S and the friend is about to
 * match it, with the extra E the creator is adding. Signed in, it is worded
 * for the friend ("Match @andre's 10.00 USDC stake"); signed out there is no
 * name yet, so it reads as the creator's own challenge.
 */
export function challengePreviewOf(input: {
  stake: bigint;
  extra: bigint;
  /** missRuleWouldApply for the goal typed so far. */
  recordable: boolean;
  /** The creator's "@handle" when signed in; null words it for the creator. */
  creatorName: string | null;
  /** The friend's "@handle" when one is typed. */
  friendName: string | null;
}): { money: RunMoney; pot: bigint; potLine: string; headline: string } {
  const asFriend = input.creatorName !== null;
  const creator = input.creatorName ?? "you";
  const friend = input.friendName ?? "your friend";
  const money = runMoneyOf({
    pool: { bountyModel: COMMITMENT_MODEL, initiative: CHALLENGE_INITIATIVE },
    flow: {
      players: 1,
      creatorStaked: true,
      kind: "self",
      creatorName: creator,
      viewerIsCreator: !asFriend,
    },
    numbers: {
      entryFee: input.stake,
      players: 1,
      pot: input.extra,
      // V4 takes no cut (commitmentFeeBps 0); the live page reads the fee.
      feeBps: 0,
      recordable: input.recordable,
      includeJoiner: true,
      confirmBy: null,
    },
  });
  const stake = usd(input.stake);
  return {
    money,
    pot: input.stake * 2n + input.extra,
    headline: asFriend
      ? `Match ${creator}'s ${stake} USDC stake`
      : `You stake ${stake} USDC. ${input.friendName ?? "Your friend"} matches it.`,
    potLine: asFriend
      ? potLineOf({ stake: input.stake, stakers: ["you", creator], extra: input.extra, extraFrom: creator, when: "once you match" })
      : potLineOf({
          stake: input.stake,
          stakers: ["you", friend],
          extra: input.extra,
          extraFrom: "you",
          when: `once ${friend} matches`,
        }),
  };
}
