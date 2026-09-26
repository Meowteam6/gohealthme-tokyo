// What a commitment run (bountyModel 2) says about money, on every screen
// that says it: the lobby row, the run page, the coin, the run board and the
// verdict. Pure, so every sentence is tested with exact numbers.
//
// Every figure comes from lib/commitment.ts, which mirrors
// HealthPoolsV3._settleCommitment. Nothing here does its own payout math.
//
// This copy is the compliance line as much as it is UI: everyone stakes the
// same, the result depends only on the player's own verified effort, and a hit
// always starts with the player's own stake coming back. Never bet, wager,
// odds, gamble or a prize-first framing.

import { commitmentRange } from "@/lib/commitment";
import { formatUsdc, parseUsdc } from "@/lib/contract";

export interface CommitmentTerms {
  /** Stake per player, in uUSDC. */
  entryFee: bigint;
  /** Players in the run now (participantCount), not counting a joiner. */
  players: number;
  /** pool.balance before settle: every stake plus any sponsor money. */
  balance: bigint;
  /** commitmentFeeBps read from chain; null when it could not be read. */
  feeBps: number | null;
}

/** Sponsor money in a live pool: the balance minus every player's stake. */
export function sponsorPotOf(t: Pick<CommitmentTerms, "entryFee" | "players" | "balance">): bigint {
  const pot = t.balance - t.entryFee * BigInt(t.players);
  return pot < 0n ? 0n : pot;
}

/** The lobby row's compact terms. True for every player count and fee. */
export function commitmentRowTerms(entryFee: bigint): string {
  return `Stake ${formatUsdc(entryFee)} · get it back + a share if you hit`;
}

/** What a hit pays at the two ends, or null when the fee is unknown (a
 *  number we cannot stand behind is not shown). */
export function hitRange(
  t: CommitmentTerms,
  includeJoiner: boolean,
): { low: bigint; high: bigint } | null {
  if (t.feeBps === null) return null;
  const range = commitmentRange({
    entryFee: t.entryFee,
    players: t.players,
    sponsorPot: sponsorPotOf(t),
    feeBps: t.feeBps,
    includeJoiner,
  });
  return { low: range.ifEveryone, high: range.ifOnlyYou };
}

export function feeLine(feeBps: number | null): string | null {
  if (feeBps === null) return null;
  if (feeBps === 0) return "GoHealthMe takes no cut on this build.";
  const pct = (feeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `GoHealthMe keeps ${pct}% of missed stakes, never any of a stake that hit.`;
}

export interface HowItPays {
  same: string;
  hit: string;
  /** Today's numbers for a hit, or null when they cannot be stated exactly. */
  range: string | null;
  miss: string;
  nobody: string;
  fee: string | null;
}

/**
 * The "How this run pays" lines. `joining` counts the reader as a player who
 * is about to stake, so the numbers are what they would get after joining.
 */
export function howThisRunPays(t: CommitmentTerms, joining: boolean): HowItPays {
  const stake = formatUsdc(t.entryFee);
  const sponsor = sponsorPotOf(t);
  const r = hitRange(t, joining);
  const n = t.players + (joining ? 1 : 0);
  let range: string | null = null;
  if (r !== null) {
    const who = n === 1 ? "With just you in" : `With ${n} players in`;
    range =
      r.low === r.high
        ? `${who}, a hit pays ${formatUsdc(r.low)} USDC.`
        : `${who}, a hit pays ${formatUsdc(r.low)} USDC if everyone hits, up to ${formatUsdc(r.high)} USDC if only you do.`;
  }
  return {
    same: `Everyone puts in the same ${stake} USDC. Your result depends only on what your wearable verifies, never on chance.`,
    hit:
      sponsor > 0n
        ? `Hit your goal: your ${stake} comes back, plus an equal share of the missed stakes and the ${formatUsdc(sponsor)} USDC sponsor pot.`
        : `Hit your goal: your ${stake} comes back, plus an equal share of the stakes of players who missed.`,
    range,
    miss: `Miss it: your ${stake} goes to the players who hit.`,
    nobody: "Nobody hits: everyone gets their stake back.",
    fee: feeLine(t.feeBps),
  };
}

/** One plain line under the coin, before the commit. */
export function joinTermsLine(t: CommitmentTerms): string {
  const stake = formatUsdc(t.entryFee);
  const r = hitRange(t, true);
  const hit =
    r === null
      ? `Hit it: your ${stake} back plus a share.`
      : r.high > t.entryFee
        ? `Hit it: your ${stake} back plus up to ${formatUsdc(r.high - t.entryFee)} more.`
        : `Hit it: your ${stake} back.`;
  return `${hit} Miss: your ${stake} goes to the players who hit. Nobody hits: it comes back to you.`;
}

/**
 * The paid verdict's breakdown, split from the amount the settle actually
 * credited (the ledger's AchieverPaid figure), the same way commitmentOutcome
 * splits it: stakeBack is the entry fee, the rest came from others.
 */
export function paidBreakdown(paidUsd: string, entryFee: bigint): string {
  let paid: bigint;
  try {
    paid = parseUsdc(paidUsd);
  } catch {
    return `${paidUsd} USDC credited to you.`;
  }
  const stake = formatUsdc(entryFee);
  if (paid < entryFee) return `${formatUsdc(paid)} USDC credited to you.`;
  const extra = paid - entryFee;
  if (extra === 0n) {
    return `${stake} stake back. Everyone hit it, so there were no missed stakes to share.`;
  }
  return `${stake} stake back + ${formatUsdc(extra)} from missed stakes and any sponsor pot.`;
}

/**
 * A commitment run the player did not hit, once settled. `stakeBack` is true
 * when no miss was written on chain (the settle refunds that stake, contract
 * B-2); `achievers` is how many hit, or null while that read is loading.
 */
export function commitmentLostCopy(input: {
  entryFee: bigint;
  stakeBack: boolean;
  achievers: number | null;
}): { headline: string; body: string } {
  const stake = formatUsdc(input.entryFee);
  if (input.stakeBack) {
    return {
      headline: "Run lost",
      body: `The goal was not met. No miss was written on chain, so the settle sent your ${stake} back. Claim it below.`,
    };
  }
  if (input.achievers === 0) {
    return {
      headline: "Nobody hit it",
      body: `Nobody hit it. Everyone's stake comes back, your ${stake} included. Claim it below.`,
    };
  }
  if (input.achievers === null) {
    return {
      headline: "Run lost",
      body: `The miss was recorded on chain. If anyone hit it, your ${stake} went to them; if nobody did, it comes back to you below.`,
    };
  }
  return {
    headline: "Run lost",
    body: `Your ${stake} went to the players who hit.`,
  };
}
