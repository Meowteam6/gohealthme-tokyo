// The commitment model (HealthPoolsV3 bountyModel 2), in one place so every
// screen states the numbers the contract will actually pay. Mirrors
// HealthPoolsV3._settleCommitment:
//   - everyone stakes the same entry fee;
//   - nobody hits: every stake is refunded, nothing forfeited or taxed;
//   - otherwise the pot (every stake plus any sponsor pot) minus the fee is
//     split equally among the players who hit, so each gets their own stake
//     back plus an equal share of the missed stakes and the sponsor pot;
//   - the fee (commitmentFeeBps, 0 on V4) is taken from missed stakes only;
//   - integer dust stays in the pool.
// Outcomes depend on each player's own verified effort, never on chance, and
// a player's first claim is always their own stake: that is the compliance
// line the UI has to make visible.

const BPS = 10_000n;

export interface CommitmentInput {
  /** Stake per player, in the token's base units (uUSDC). */
  entryFee: bigint;
  /** Players whose result was recorded (unadjudicated players are refunded separately). */
  players: number;
  /** Players who hit the goal. */
  achievers: number;
  /** Sponsor money in the pool on top of the stakes. */
  sponsorPot: bigint;
  /** Fee on missed stakes, in basis points. 0 on V4. */
  feeBps?: number;
}

export type CommitmentOutcome =
  | { kind: "refund-all"; refundEach: bigint }
  | { kind: "paid"; perAchiever: bigint; stakeBack: bigint; fromOthers: bigint; fee: bigint };

export function commitmentOutcome(input: CommitmentInput): CommitmentOutcome {
  const { entryFee, players, achievers, sponsorPot } = input;
  if (achievers <= 0) return { kind: "refund-all", refundEach: entryFee };
  const feeBps = BigInt(input.feeBps ?? 0);
  const pot = entryFee * BigInt(players) + sponsorPot;
  const forfeited = BigInt(players - achievers) * entryFee;
  const fee = (forfeited * feeBps) / BPS;
  const perAchiever = (pot - fee) / BigInt(achievers);
  return {
    kind: "paid",
    perAchiever,
    stakeBack: entryFee,
    fromOthers: perAchiever - entryFee,
    fee,
  };
}

/**
 * What a player who hits can receive, at the two ends: everyone else misses,
 * or everyone hits. `includeJoiner` counts a player who is about to join.
 *
 * `recordsMisses` is whether SPOTTER can write a miss on this run
 * (lib/miss-rule.ts). When it cannot, a player who misses has no recorded
 * result, so settle refunds that stake before the split (HealthPoolsV3 B-2)
 * and "only you hit" leaves just your stake and the sponsor pot in the split.
 */
export function commitmentRange(input: {
  entryFee: bigint;
  players: number;
  sponsorPot: bigint;
  feeBps?: number;
  includeJoiner?: boolean;
  recordsMisses?: boolean;
}): { ifOnlyYou: bigint; ifEveryone: bigint } {
  const players = input.players + (input.includeJoiner ? 1 : 0);
  const base = { entryFee: input.entryFee, players, sponsorPot: input.sponsorPot, feeBps: input.feeBps };
  const only = commitmentOutcome(
    input.recordsMisses === false ? { ...base, players: 1, achievers: 1 } : { ...base, achievers: 1 },
  );
  const all = commitmentOutcome({ ...base, achievers: players });
  const amount = (o: CommitmentOutcome) => (o.kind === "paid" ? o.perAchiever : o.refundEach);
  return { ifOnlyYou: amount(only), ifEveryone: amount(all) };
}
