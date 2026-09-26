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
import { missRulePool } from "@/lib/miss-rule";

export interface CommitmentTerms {
  /** Stake per player, in uUSDC. */
  entryFee: bigint;
  /** Players in the run now (participantCount), not counting a joiner. */
  players: number;
  /** pool.balance before settle: every stake plus any sponsor money. */
  balance: bigint;
  /** commitmentFeeBps read from chain; null when it could not be read. */
  feeBps: number | null;
  /** Whether SPOTTER can record a miss on this run (lib/miss-rule.ts). When
   *  it cannot, a miss is refunded at settle and no missed stake is shared. */
  recordsMisses: boolean;
}

/**
 * Can a miss on this pool go to the players who hit? Only a pool the miss
 * rule covers (lib/miss-rule.ts): commitment model, wearable only, sleep or
 * workouts, a plain count, created at or after MISS_RULE_FROM_POOL_ID. Every
 * other pool refunds a miss at settle, and its copy has to say so.
 */
export function recordsMissesOf(pool: { id: bigint; bountyModel: number; goalSpec: string }): boolean {
  return missRulePool(pool).ok;
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
    recordsMisses: t.recordsMisses,
  });
  return { low: range.ifEveryone, high: range.ifOnlyYou };
}

export function feeLine(feeBps: number | null): string | null {
  if (feeBps === null) return null;
  if (feeBps === 0) return "GoHealthMe takes no cut on this build.";
  const pct = (feeBps / 100).toLocaleString("en-US", { maximumFractionDigits: 2 });
  return `GoHealthMe keeps ${pct}% of missed stakes, never any of a stake that hit.`;
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
    return `${paidUsd} USDC paid out.`;
  }
  const stake = formatUsdc(entryFee);
  if (paid < entryFee) return `${formatUsdc(paid)} USDC paid out.`;
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

/**
 * The four facts with no number past the stake, worded as
 * components/CommitmentTerms.tsx words them, for the places that cannot state
 * a range (a count that did not read) and the run board's reminder.
 */
export const COMMITMENT_FACTS = {
  effort: "Your result depends only on your own effort, verified by your wearable.",
  hit: "Hit it: your stake back plus an equal share of the missed stakes and any sponsor pot.",
  miss: "Miss it: if your wearable shows it, your stake goes to the players who hit. If your wearable sends nothing for the run, your stake comes back.",
  nobody: "Nobody hits: everyone gets their stake back.",
  /** A run that cannot record a miss (lib/miss-rule.ts): no missed stake is
   *  ever shared, so a hit is the stake back plus any sponsor pot. */
  hitNoMiss: "Hit it: your stake back plus an equal share of any sponsor pot.",
  missNoMiss: "Miss it: this run cannot record a miss, so your stake comes back when it settles.",
} as const;

/** The facts for one run: the miss line follows whether it can record one. */
export function commitmentFacts(recordsMisses: boolean): {
  effort: string;
  hit: string;
  miss: string;
  nobody: string;
} {
  return {
    effort: COMMITMENT_FACTS.effort,
    hit: recordsMisses ? COMMITMENT_FACTS.hit : COMMITMENT_FACTS.hitNoMiss,
    miss: recordsMisses ? COMMITMENT_FACTS.miss : COMMITMENT_FACTS.missNoMiss,
    nobody: COMMITMENT_FACTS.nobody,
  };
}

/** The run board's reminder under the money, for a player already in. */
export function commitmentReminder(recordsMisses: boolean): string {
  const f = commitmentFacts(recordsMisses);
  return `${f.hit} ${f.miss} ${f.nobody}`;
}
