// Pool lifecycle classification and display ordering, extracted so the pool
// list, the pool page, and the goal-match ranking all agree on what "live"
// means. The predicate deliberately mirrors /api/goals/match (a pool is live
// only while !settled && periodEnd > now) - if the two ever drift, an expired
// pool can look joinable and hand the user a raw PERIOD_ENDED revert. Pure
// and chain-free so it runs under vitest's node environment.

export type PoolPhase = "live" | "expired" | "settled";

/** The minimal pool shape lifecycle decisions depend on. */
export interface LifecycleFields {
  settled: boolean;
  periodEnd: bigint;
}

/**
 * Classify a pool at a moment in time (unix seconds). "expired" means the
 * period has ended but settlement has not run yet - joining reverts on-chain,
 * while evidence and receipts remain meaningful.
 */
export function poolPhase(
  pool: LifecycleFields,
  nowSeconds: bigint,
): PoolPhase {
  if (pool.settled) return "settled";
  return pool.periodEnd > nowSeconds ? "live" : "expired";
}

/** The minimal pool shape the payability check depends on. */
export interface PayabilityFields {
  entryFee: bigint;
  bountyModel: number;
}

/**
 * A createPool config the deployed contract will not accept, or that could
 * never pay an achiever: any pool with a zero entry fee.
 *
 * HealthPoolsV3 (audit finding H-1) requires `entryFee > 0` for EVERY bounty
 * model - createPool reverts DEAD_CONFIG otherwise - because a fee-free pool
 * lets winners collect without ever staking. That on-chain rule subsumes the
 * older F-1 case (fixed bounty at a zero fee derives every payout from
 * entryFee and so settles to zero for everyone): under V3 a zero fee is dead
 * for models 0, 1, and 2 alike, before any payout math runs.
 *
 * This is the single source of truth for that invariant. The create path
 * guards on it before any tx is sent (CreatePool submit and the runUsdcDeposit
 * funnel that every createPool passes through), so the user gets a plain
 * message instead of an on-chain DEAD_CONFIG revert; the read path uses its
 * negation, poolCanPay, to hide unpayable pools from the list (nothing to
 * hide on V3 - the contract cannot hold a fee-zero pool - but the predicate
 * also covers any legacy data a future migration might surface).
 *
 * bountyModel stays in the signature so call sites keep naming both halves of
 * the config they are guarding; under V3 the verdict no longer depends on it.
 */
export function isEconomicallyDeadConfig(
  bountyModel: number,
  entryFee: bigint,
): boolean {
  void bountyModel;
  return entryFee === 0n;
}

/**
 * Whether a pool can pay an achiever at all - the negation of
 * isEconomicallyDeadConfig. This is a predicate rather than a list of pool ids
 * on purpose: it also catches any future pool seeded the same way. Callers hide
 * failing pools from the joinable list.
 */
export function poolCanPay(pool: PayabilityFields): boolean {
  return !isEconomicallyDeadConfig(pool.bountyModel, pool.entryFee);
}

export interface GroupedPools<T> {
  live: T[];
  expired: T[];
  settled: T[];
}

function byPeriodEndAsc(a: LifecycleFields, b: LifecycleFields): number {
  return a.periodEnd < b.periodEnd ? -1 : a.periodEnd > b.periodEnd ? 1 : 0;
}

/**
 * Group pools for display: live first (soonest-ending first, so urgency
 * leads), then expired awaiting settlement (most recently ended first),
 * then settled (most recently ended first). Ties keep the input order,
 * which callers provide sorted by pool id.
 */
export function groupPoolsByPhase<T extends LifecycleFields>(
  pools: T[],
  nowSeconds: bigint,
): GroupedPools<T> {
  const live: T[] = [];
  const expired: T[] = [];
  const settled: T[] = [];
  for (const pool of pools) {
    const phase = poolPhase(pool, nowSeconds);
    if (phase === "live") live.push(pool);
    else if (phase === "expired") expired.push(pool);
    else settled.push(pool);
  }
  live.sort(byPeriodEndAsc);
  expired.sort((a, b) => byPeriodEndAsc(b, a));
  settled.sort((a, b) => byPeriodEndAsc(b, a));
  return { live, expired, settled };
}
